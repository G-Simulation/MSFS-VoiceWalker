@echo off
REM ============================================================================
REM VoiceWalker — WASM-Modul-Build (direkter clang-cl + wasm-ld Aufruf)
REM ============================================================================
REM
REM Warum diese .bat statt ein vcxproj?
REM   Das MSFS 2024 SDK liefert die clang-cl.exe- und wasm-ld.exe-Binaries
REM   direkt mit. Der offizielle VS-Weg (PlatformToolset=MSFS2024) setzt
REM   voraus, dass die MSFS VS-Extension installiert ist — die funktioniert
REM   aber nur mit VS 2022. Auf VS 2026 oder ohne Extension scheitert das.
REM
REM   Dieser Weg hier ruft clang-cl.exe und wasm-ld.exe direkt auf und nutzt
REM   die Compile-/Link-Flags aus dem SDK-Toolset-File
REM   (C:\MSFS 2024 SDK\WASM\vs\2022\Microsoft.Cpp.MSFS.Common.targets).
REM   Funktioniert unabhaengig von VS-Version und -Extension.
REM
REM Aufruf:
REM   tools\build-wasm.bat             (nutzt Default-SDK-Pfad)
REM   tools\build-wasm.bat "C:\MSFS 2024 SDK"   (expliziter SDK-Pfad)
REM ============================================================================

setlocal EnableDelayedExpansion

REM --- Pfade ------------------------------------------------------------------
set "REPO=%~dp0.."
set "MSFS_SDK=%~1"
if "%MSFS_SDK%"=="" set "MSFS_SDK=C:\MSFS 2024 SDK"

set "LLVM_BIN=%MSFS_SDK%\WASM\llvm\bin"
set "CLANG=%LLVM_BIN%\clang-cl.exe"
set "WASMLD=%LLVM_BIN%\wasm-ld.exe"

set "SRC_DIR=%REPO%\msfs-project\Sources\wasm"
set "OUT_DIR=%SRC_DIR%\bin\Release"
set "PKG_DIR=%REPO%\msfs-project\PackageSources\modules"

set "SOURCE=%SRC_DIR%\VoiceWalkerBridge.cpp"
set "OBJ=%OUT_DIR%\VoiceWalkerBridge.o"
set "WASM=%OUT_DIR%\VoiceWalkerBridge.wasm"

REM --- Praechecks -------------------------------------------------------------
if not exist "%CLANG%" (
  echo [WASM] FEHLER: clang-cl.exe nicht gefunden unter "%CLANG%"
  echo [WASM] Ist das MSFS 2024 SDK an "%MSFS_SDK%" installiert?
  exit /b 10
)
if not exist "%WASMLD%" (
  echo [WASM] FEHLER: wasm-ld.exe nicht gefunden unter "%WASMLD%"
  exit /b 11
)
if not exist "%SOURCE%" (
  echo [WASM] FEHLER: Quelldatei nicht gefunden: "%SOURCE%"
  exit /b 12
)
if not exist "%MSFS_SDK%\WASM\wasi-sysroot\lib\wasm32-wasi\libc.a" (
  echo [WASM] FEHLER: libc.a fehlt. Bitte MSFS 2024 SDK vollstaendig installieren
  echo [WASM]         (insbesondere die WASM-Toolchain-Komponente).
  exit /b 13
)
if not exist "%MSFS_SDK%\WASM\WasmVersions\MSFS_WasmVersions.a" (
  echo [WASM] FEHLER: MSFS_WasmVersions.a fehlt.
  exit /b 14
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if not exist "%PKG_DIR%" mkdir "%PKG_DIR%"

REM --- Compile ----------------------------------------------------------------
echo.
echo [WASM] === Compile VoiceWalkerBridge.cpp ===
"%CLANG%" ^
  /c /O2 /Zc:__cplusplus ^
  /DNDEBUG /D_MSFS_WASM ^
  /D_STRING_H_CPLUSPLUS_98_CONFORMANCE_ ^
  /D_WCHAR_H_CPLUSPLUS_98_CONFORMANCE_ ^
  /D_LIBCPP_NO_EXCEPTIONS /D_LIBCPP_HAS_NO_THREADS ^
  /I"%MSFS_SDK%\WASM\wasi-sysroot\include" ^
  /I"%MSFS_SDK%\WASM\wasi-sysroot\include\c++\v1" ^
  /I"%MSFS_SDK%\WASM\include" ^
  /I"%MSFS_SDK%\SimConnect SDK\include" ^
  --target=wasm32-unknown-wasi ^
  /clang:--sysroot="%MSFS_SDK%\WASM\wasi-sysroot" ^
  /clang:-fstack-size-section ^
  /clang:-mbulk-memory ^
  /clang:-fvisibility=hidden ^
  /clang:-ffunction-sections ^
  /clang:-fdata-sections ^
  /clang:-fno-stack-protector ^
  /clang:-fno-exceptions ^
  /clang:-fms-extensions ^
  /clang:-fwritable-strings ^
  -Werror=return-type ^
  -Wno-unused-command-line-argument ^
  /Fo"%OBJ%" ^
  "%SOURCE%"

if errorlevel 1 (
  echo.
  echo [WASM] FEHLER: Compile fehlgeschlagen.
  exit /b 20
)

REM --- Link -------------------------------------------------------------------
echo.
echo [WASM] === Link VoiceWalkerBridge.wasm ===
"%WASMLD%" ^
  --no-entry ^
  --stack-guard-page ^
  --allow-undefined ^
  --export-dynamic ^
  --export=malloc ^
  --export=free ^
  --export=__wasm_call_ctors ^
  --export-table ^
  --export=mallinfo ^
  --export=mchunkit_begin ^
  --export=mchunkit_next ^
  --export=get_pages_state ^
  --export=mark_decommit_pages ^
  --export=GetSimConnectVersion ^
  --strip-debug ^
  --gc-sections ^
  -O3 ^
  --lto-O3 ^
  -L "%MSFS_SDK%\WASM\wasi-sysroot\lib\wasm32-wasi" ^
  -o "%WASM%" ^
  "%OBJ%" ^
  -lc++ -lc++abi -lc ^
  "%MSFS_SDK%\WASM\wasi-sysroot\lib\wasm32-wasi\libclang_rt.builtins-wasm32.a" ^
  -lc ^
  "%MSFS_SDK%\WASM\WasmVersions\MSFS_WasmVersions.a"

if errorlevel 1 (
  echo.
  echo [WASM] FEHLER: Link fehlgeschlagen.
  exit /b 21
)

REM --- Ins Package-Staging kopieren -------------------------------------------
echo.
echo [WASM] === Copy to %PKG_DIR% ===
copy /Y "%WASM%" "%PKG_DIR%\" >nul
if errorlevel 1 (
  echo [WASM] FEHLER: Copy fehlgeschlagen.
  exit /b 22
)

echo.
echo [WASM] BUILD OK: %PKG_DIR%\VoiceWalkerBridge.wasm
exit /b 0
