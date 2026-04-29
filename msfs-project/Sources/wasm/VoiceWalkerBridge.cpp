// ============================================================================
// VoiceWalkerBridge — WASM standalone module for MSFS 2024
// ----------------------------------------------------------------------------
// Liest Aircraft- UND Avatar-Position via fsVars (FS_OBJECT_ID_USER_AIRCRAFT /
// _USER_AVATAR / _USER_CURRENT) und VEROEFFENTLICHT sie in eine SimConnect
// ClientData-Area namens "VoiceWalkerPos". Die Python-Seite abonniert
// die Area und bekommt bei jedem SetClientData einen Dispatch.
//
// Warum ClientData statt HTTP:
//   - MSFS 2024 Standalone-WASM-Module koennen offenbar kein externes HTTP
//     ausfuehren (fsNetworkHttpRequestGet liefert requestId=0 — silent fail).
//   - ClientData ist der offiziell unterstuetzte WASM<->External-Kanal und
//     wird von Navigraph, SPAD.next etc. genauso verwendet.
//
// Payload-Layout (siehe struct VoiceWalkerPos unten) — Python MUSS exakt
// dieselbe Struktur parsen. Jede Aenderung hier erfordert Python-Update.
// ============================================================================
#include <MSFS/MSFS.h>
#include <MSFS/MSFS_Core.h>
#include <MSFS/MSFS_Vars.h>
#include <MSFS/MSFS_WindowsTypes.h>
#include <SimConnect.h>

#include <cstdio>
#include <cstring>

// ----------------------------------------------------------------------------
// Globals
// ----------------------------------------------------------------------------
static HANDLE   s_simConnect   = 0;
static unsigned s_tickCount    = 0;

static FsAVarId s_planeLat     = FS_VAR_INVALID_ID;
static FsAVarId s_planeLon     = FS_VAR_INVALID_ID;
static FsAVarId s_planeAlt     = FS_VAR_INVALID_ID;
static FsAVarId s_heading      = FS_VAR_INVALID_ID;
static FsAVarId s_altAboveGnd  = FS_VAR_INVALID_ID;
static FsAVarId s_cameraState  = FS_VAR_INVALID_ID;
static FsAVarId s_engineType   = FS_VAR_INVALID_ID;
static FsAVarId s_engCombust1  = FS_VAR_INVALID_ID;
// Head-Pitch fuer Walker-Mode (rauf/runter schauen). Wirkt auf 3D-Audio-
// Listener-Tilt: schaut der Spieler nach unten, klingt ein Peer der seitlich
// neben ihm steht relativ "ueber" ihm. Im Cockpit-Mode sollte der Wert
// idealerweise auch funktionieren (Headlook-Tracker), kostet uns aber nichts
// das ueberall mitzulesen.
static FsAVarId s_headPitch    = FS_VAR_INVALID_ID;

static FsUnitId s_unitDegLat   = FS_INVALID_UNIT;
static FsUnitId s_unitDegLon   = FS_INVALID_UNIT;
static FsUnitId s_unitDegrees  = FS_INVALID_UNIT;
static FsUnitId s_unitFeet     = FS_INVALID_UNIT;
static FsUnitId s_unitEnum     = FS_INVALID_UNIT;

static bool s_loggedFirstDispatch = false;
static bool s_loggedFirstProbe    = false;
static bool s_loggedFirstSet      = false;
static bool s_cdaInitialized      = false;

enum {
    DEF_TICK            = 1,
    REQ_TICK            = 1,
    EVENT_FLIGHT_LOADED = 100,
    EVENT_SIM_START     = 101,
    EVENT_1SEC          = 102,
    EVENT_4SEC          = 103,

    // ClientData IDs — muessen Python-Seitig gespiegelt werden
    CD_AREA_ID          = 0x56574C4B,  // 'VWLK' — VoiceWalker
    CD_DEF_ID           = 0x56574C4B,
};

static const char* CD_NAME = "VoiceWalkerPos";

static bool s_periodicStarted     = false;
static unsigned s_simobjDataCount = 0;
static unsigned s_simobjDataAtLastCheck = 0;

// ----------------------------------------------------------------------------
// Payload-Struktur — MUSS identisch mit Python-Seitiger ctypes.Structure sein.
// Alle Felder sind doubles (8 Bytes, natuerlich 8-byte-aligned → kein Padding-
// Problem zwischen Compilern). 17 doubles = 136 Bytes total.
//
// ACHTUNG: Wenn du hier Felder aenderst, IMMER auch main.py::VoiceWalkerPos
// anpassen und VoiceWalkerPos.__size__ auf 136 abgleichen.
// ----------------------------------------------------------------------------
#pragma pack(push, 1)
struct VoiceWalkerPos {
    double ac_lat;   double ac_lon;   double ac_alt;   double ac_hdg;   double ac_agl;
    double av_lat;   double av_lon;   double av_alt;   double av_hdg;   double av_agl;
    double cur_lat;  double cur_lon;  double cur_alt;  double cur_hdg;  double cur_agl;
    double cam_state;
    double engine_type;       // 0=piston, 1=jet, 2=none, 3=heli, 4=unsupported, 5=turboprop
    double engines_running;   // 0=aus, 1=an (ENG COMBUSTION:1)
    double head_pitch;        // Grad: positiv = nach oben, negativ = nach unten (Walker-Mode)
    double tick;
};
#pragma pack(pop)
static_assert(sizeof(VoiceWalkerPos) == 20 * 8,
              "VoiceWalkerPos must be exactly 160 bytes (20 doubles, packed)");

// ----------------------------------------------------------------------------
struct TargetPos { double lat=0, lon=0, alt=0, hdg=0, agl=0; };

static void start_periodic_request();

static void resolve_ids() {
    if (s_planeLat != FS_VAR_INVALID_ID) return;
    s_planeLat     = fsVarsGetAVarId("PLANE LATITUDE");
    s_planeLon     = fsVarsGetAVarId("PLANE LONGITUDE");
    s_planeAlt     = fsVarsGetAVarId("PLANE ALTITUDE");
    s_heading      = fsVarsGetAVarId("PLANE HEADING DEGREES TRUE");
    s_altAboveGnd  = fsVarsGetAVarId("PLANE ALT ABOVE GROUND");
    s_cameraState  = fsVarsGetAVarId("CAMERA STATE");
    s_engineType   = fsVarsGetAVarId("ENGINE TYPE");
    s_engCombust1  = fsVarsGetAVarId("GENERAL ENG COMBUSTION:1");
    // Head-Pitch: MSFS 2024 expose-Name kann variieren. Wir versuchen die
    // bekannten Kandidaten in Reihenfolge — erster der eine gueltige ID
    // zurueckgibt, gewinnt. Wenn alle FS_VAR_INVALID_ID liefern, bleibt
    // head_pitch auf 0 (kein Effekt im Audio, harmlos).
    s_headPitch    = fsVarsGetAVarId("CAMERA HEADLOOK PITCH");
    if (s_headPitch == FS_VAR_INVALID_ID)
        s_headPitch = fsVarsGetAVarId("AVATAR PITCH");
    if (s_headPitch == FS_VAR_INVALID_ID)
        s_headPitch = fsVarsGetAVarId("CAMERA REQUEST ACTION");
    s_unitDegLat   = fsVarsGetUnitId("degrees latitude");
    s_unitDegLon   = fsVarsGetUnitId("degrees longitude");
    s_unitDegrees  = fsVarsGetUnitId("degrees");
    s_unitFeet     = fsVarsGetUnitId("feet");
    s_unitEnum     = fsVarsGetUnitId("number");

    std::printf("[VoiceWalker] resolved IDs: "
                 "lat=%d lon=%d alt=%d hdg=%d agl=%d cam=%d\n",
                 (int)s_planeLat, (int)s_planeLon, (int)s_planeAlt,
                 (int)s_heading, (int)s_altAboveGnd, (int)s_cameraState);
}

static unsigned read_target(FsObjectId target, TargetPos& out) {
    FsVarParamArray noParams = { 0, nullptr };
    FsVarError e1 = fsVarsAVarGet(s_planeLat,    s_unitDegLat,  noParams, &out.lat, target);
    FsVarError e2 = fsVarsAVarGet(s_planeLon,    s_unitDegLon,  noParams, &out.lon, target);
    FsVarError e3 = fsVarsAVarGet(s_planeAlt,    s_unitFeet,    noParams, &out.alt, target);
    FsVarError e4 = fsVarsAVarGet(s_heading,     s_unitDegrees, noParams, &out.hdg, target);
    FsVarError e5 = fsVarsAVarGet(s_altAboveGnd, s_unitFeet,    noParams, &out.agl, target);
    if (e1) return (unsigned)e1;
    if (e2) return (unsigned)e2;
    if (e3) return (unsigned)e3;
    if (e4) return (unsigned)e4;
    if (e5) return (unsigned)e5;
    return 0;
}

// ----------------------------------------------------------------------------
// ClientData area initialisieren. Das geht nur EINMAL — wenn es schon
// existiert (z.B. weil Modul nach Dev-Reload erneut laedt), ignorieren wir
// Fehler. MapClientDataNameToID ist idempotent.
// ----------------------------------------------------------------------------
static bool init_client_data() {
    if (s_cdaInitialized) return true;
    if (!s_simConnect) return false;

    HRESULT hr;
    hr = SimConnect_MapClientDataNameToID(s_simConnect, CD_NAME, CD_AREA_ID);
    std::printf("[VoiceWalker] MapClientDataNameToID hr=0x%lx\n", (long)hr);
    if (hr != S_OK) return false;

    // CreateClientData darf "schon existiert" zurueckgeben, das ist OK
    hr = SimConnect_CreateClientData(
        s_simConnect, CD_AREA_ID,
        (DWORD)sizeof(VoiceWalkerPos),
        SIMCONNECT_CREATE_CLIENT_DATA_FLAG_DEFAULT);
    std::printf("[VoiceWalker] CreateClientData sz=%u hr=0x%lx\n",
                 (unsigned)sizeof(VoiceWalkerPos), (long)hr);

    hr = SimConnect_AddToClientDataDefinition(
        s_simConnect, CD_DEF_ID,
        0,                                     // dwOffset — ab Anfang
        (DWORD)sizeof(VoiceWalkerPos),         // dwSizeOrType — ganzer Block
        0.0f,                                  // fEpsilon
        SIMCONNECT_UNUSED);                    // DatumId
    std::printf("[VoiceWalker] AddToClientDataDefinition hr=0x%lx\n", (long)hr);
    if (hr != S_OK) return false;

    s_cdaInitialized = true;
    return true;
}

// ----------------------------------------------------------------------------
// Payload fuellen und via SetClientData publizieren.
// ----------------------------------------------------------------------------
static void fire_probe() {
    resolve_ids();
    if (!s_cdaInitialized && !init_client_data()) return;

    TargetPos ac, av, cur;
    double camState = 0.0;

    unsigned errAc  = read_target(FS_OBJECT_ID_USER_AIRCRAFT, ac);
    unsigned errAv  = read_target(FS_OBJECT_ID_USER_AVATAR,   av);
    unsigned errCur = read_target(FS_OBJECT_ID_USER_CURRENT,  cur);

    FsVarParamArray noParams = { 0, nullptr };
    fsVarsAVarGet(s_cameraState, s_unitEnum, noParams, &camState,
                   FS_OBJECT_ID_USER_CURRENT);

    double engType = 0.0, engRun = 0.0, headPitch = 0.0;
    fsVarsAVarGet(s_engineType,  s_unitEnum, noParams, &engType,
                   FS_OBJECT_ID_USER_AIRCRAFT);
    fsVarsAVarGet(s_engCombust1, s_unitEnum, noParams, &engRun,
                   FS_OBJECT_ID_USER_AIRCRAFT);
    if (s_headPitch != FS_VAR_INVALID_ID) {
        fsVarsAVarGet(s_headPitch, s_unitDegrees, noParams, &headPitch,
                       FS_OBJECT_ID_USER_CURRENT);
    }

    VoiceWalkerPos p{};
    p.ac_lat  = ac.lat;  p.ac_lon  = ac.lon;  p.ac_alt  = ac.alt;
    p.ac_hdg  = ac.hdg;  p.ac_agl  = ac.agl;
    p.av_lat  = av.lat;  p.av_lon  = av.lon;  p.av_alt  = av.alt;
    p.av_hdg  = av.hdg;  p.av_agl  = av.agl;
    p.cur_lat = cur.lat; p.cur_lon = cur.lon; p.cur_alt = cur.alt;
    p.cur_hdg = cur.hdg; p.cur_agl = cur.agl;
    p.cam_state = camState;
    p.engine_type     = engType;
    p.engines_running = engRun;
    p.head_pitch      = headPitch;
    p.tick = (double)(++s_tickCount);

    HRESULT hr = SimConnect_SetClientData(
        s_simConnect, CD_AREA_ID, CD_DEF_ID,
        SIMCONNECT_CLIENT_DATA_SET_FLAG_DEFAULT,
        0,
        (DWORD)sizeof(VoiceWalkerPos),
        &p);

    static unsigned probeLogCount = 0;
    probeLogCount++;
    if (!s_loggedFirstProbe || (probeLogCount % 30) == 0) {
        s_loggedFirstProbe = true;
        std::printf(
            "[VoiceWalker] probe #%u: "
            "ac=%.6f/%.6f(err=%u) av=%.6f/%.6f(err=%u) "
            "cur=%.6f/%.6f(err=%u) cam=%.0f SetClientData hr=0x%lx\n",
            probeLogCount,
            ac.lat,  ac.lon,  errAc,
            av.lat,  av.lon,  errAv,
            cur.lat, cur.lon, errCur,
            camState, (long)hr);
    }

    if (!s_loggedFirstSet && hr == S_OK) {
        s_loggedFirstSet = true;
        std::printf(
            "[VoiceWalker] first SetClientData OK — sz=%u bytes\n",
            (unsigned)sizeof(VoiceWalkerPos));
    }
}

// ----------------------------------------------------------------------------
void CALLBACK MsfsVWDispatch(SIMCONNECT_RECV* pData, DWORD /*cb*/, void* /*ctx*/) {
    if (!s_loggedFirstDispatch) {
        s_loggedFirstDispatch = true;
        std::printf(
            "[VoiceWalker] first dispatch dwID=%u\n", (unsigned)pData->dwID);
    }

    if (pData->dwID == SIMCONNECT_RECV_ID_EXCEPTION) {
        SIMCONNECT_RECV_EXCEPTION* ex = (SIMCONNECT_RECV_EXCEPTION*)pData;
        std::printf(
            "[VoiceWalker] SC EXCEPTION code=%u sendID=%u index=%u\n",
            (unsigned)ex->dwException,
            (unsigned)ex->dwSendID,
            (unsigned)ex->dwIndex);
        return;
    }

    if (pData->dwID == SIMCONNECT_RECV_ID_EVENT) {
        SIMCONNECT_RECV_EVENT* ev = (SIMCONNECT_RECV_EVENT*)pData;
        if (ev->uEventID == EVENT_1SEC) {
            if (s_simobjDataCount == s_simobjDataAtLastCheck) {
                s_periodicStarted = false;
            }
            s_simobjDataAtLastCheck = s_simobjDataCount;
        }
        if (!s_periodicStarted) {
            std::printf(
                "[VoiceWalker] EVENT id=%u → retry periodic\n",
                (unsigned)ev->uEventID);
            start_periodic_request();
        }
        // CDA beim ersten Event neu versuchen falls noch nicht init
        if (!s_cdaInitialized) init_client_data();
        return;
    }

    if (pData->dwID == SIMCONNECT_RECV_ID_SIMOBJECT_DATA) {
        s_simobjDataCount++;
        s_periodicStarted = true;
        s_tickCount++;
        // Alle ~30 Ticks (≈1 Hz bei 30 fps) einen Probe publizieren.
        if ((s_tickCount % 30) == 0) fire_probe();
    }
}

static void start_periodic_request() {
    if (s_periodicStarted || !s_simConnect) return;
    HRESULT hr = SimConnect_RequestDataOnSimObject(
        s_simConnect, REQ_TICK, DEF_TICK,
        SIMCONNECT_OBJECT_ID_USER,
        SIMCONNECT_PERIOD_SIM_FRAME,
        SIMCONNECT_DATA_REQUEST_FLAG_DEFAULT,
        0, 0, 0);
    std::printf(
        "[VoiceWalker] start_periodic_request hr=0x%lx\n", (long)hr);
    if (hr == S_OK) s_periodicStarted = true;
}

// ----------------------------------------------------------------------------
extern "C" MSFS_CALLBACK void module_init(void) {
    HRESULT hr = SimConnect_Open(&s_simConnect, "VoiceWalkerBridge",
                                  nullptr, 0, 0, 0);
    if (hr != S_OK || !s_simConnect) {
        std::printf(
            "[VoiceWalker] SimConnect_Open failed: %ld\n", (long)hr);
        return;
    }

    hr = SimConnect_AddToDataDefinition(
        s_simConnect, DEF_TICK,
        "SIMULATION RATE", "number",
        SIMCONNECT_DATATYPE_FLOAT64);
    std::printf(
        "[VoiceWalker] AddToDataDefinition hr=0x%lx\n", (long)hr);

    SimConnect_SubscribeToSystemEvent(s_simConnect,
        EVENT_FLIGHT_LOADED, "FlightLoaded");
    SimConnect_SubscribeToSystemEvent(s_simConnect,
        EVENT_SIM_START, "SimStart");
    SimConnect_SubscribeToSystemEvent(s_simConnect,
        EVENT_1SEC, "1sec");
    SimConnect_SubscribeToSystemEvent(s_simConnect,
        EVENT_4SEC, "4sec");

    // ClientData direkt registrieren — Python-Seite macht
    // SimConnect_RequestClientData erst NACHDEM unser Modul die Area
    // angelegt hat, also muss das hier fruehest moeglich passieren.
    init_client_data();

    start_periodic_request();

    hr = SimConnect_CallDispatch(s_simConnect, MsfsVWDispatch, nullptr);
    std::printf(
        "[VoiceWalker] CallDispatch hr=0x%lx\n", (long)hr);

    std::printf("[VoiceWalker] module_init OK — ClientData ready\n");
}

extern "C" MSFS_CALLBACK void module_deinit(void) {
    if (s_simConnect) {
        SimConnect_Close(s_simConnect);
        s_simConnect = 0;
    }
}
