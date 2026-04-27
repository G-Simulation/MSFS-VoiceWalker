import {
  GamepadUiView,
  RequiredProps,
  TVNode,
  UiViewProps,
} from "@efb/efb-api";
import { FSComponent, VNode } from "@microsoft/msfs-sdk";

declare const BASE_URL: string;

// EFB iframet das bestehende Toolbar-Panel direkt — same-origin coui://,
// identische UI in Toolbar und EFB ohne Code-Duplikat.
const BACKEND_URL = `coui://html_ui/InGamePanels/VoiceWalker/panel-efb.html`;
const RECONNECT_MS = 4000;

interface MainViewProps extends RequiredProps<UiViewProps, "appViewService"> {}

// Inline-Styles statt CSS-Klassen (esbuild-Prefix matched die EFB-
// Container-Klasse nicht zuverlaessig). Pattern analog zur GSim-Kneeboard-
// EFB-App: iframe gegen lokalen HTTP-Server, Spinner-Fallback solange
// nicht connected. Kein auto-hide bei onLoad ohne valide src — sonst
// versteckt sich der Fallback bei about:blank-Loads und der User sieht
// nur Schwarz.
// Layout-Pattern aus dem offiziellen MSFS-SDK-EFB-Sample
// (DevmodeProjects/EFB/PackageSources/TemplateApp/src/Components/SamplePage.scss):
// width:100% + height:100% + display:flex am Root, KEIN position:absolute. Der
// AppViewWrapper des EFB-OS gibt keinen positionierten Vorfahren mit fixer Groesse,
// daher kollabiert absolute/inset:0 auf 0x0 und der View wird unsichtbar.
const STYLE_ROOT = `position: relative; width: 100%; height: 100%;
  display: flex; flex-direction: column; background-color: #0d1a2b;
  overflow: hidden;`;

const STYLE_IFRAME = `flex: 1 1 auto; width: 100%; height: 100%;
  border: none; background: transparent; display: none;`;

const STYLE_FALLBACK = `flex: 1 1 auto; display: flex;
  flex-direction: column; align-items: center; justify-content: center;
  background-color: #0d1a2b; color: #e8eef5; padding: 2rem; gap: 1.4rem;
  text-align: center;`;

const STYLE_LOGO = `display: block; max-width: 200px; width: 50%;
  height: auto; object-fit: contain;`;

const STYLE_TITLE = `font-size: 1.6rem; font-weight: 600; margin: 0;`;

const STYLE_MSG = `font-size: 1rem; opacity: 0.85; margin: 0;
  max-width: 28rem; line-height: 1.5;`;

const STYLE_SPINNER = `width: 36px; height: 36px;
  border: 3px solid rgba(232,238,245,0.2);
  border-top: 3px solid #3fdc8a; border-radius: 50%;
  animation: vw-efb-spin 1s linear infinite;`;

const STYLE_KEYFRAMES = `@keyframes vw-efb-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}`;

export class MainView extends GamepadUiView<HTMLDivElement, MainViewProps> {
  public readonly tabName = "MainView";

  private iframeRef = FSComponent.createRef<HTMLIFrameElement>();
  private fallbackRef = FSComponent.createRef<HTMLDivElement>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  public onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    const iframe = this.iframeRef.instance;
    iframe.addEventListener("load", () => this.onIframeLoad());
    iframe.addEventListener("error", () => this.onIframeError());
    this.tryConnect();
  }

  private tryConnect(): void {
    this.iframeRef.instance.src = BACKEND_URL;
  }

  private setConnected(connected: boolean): void {
    this.connected = connected;
    this.fallbackRef.instance.style.display = connected ? "none" : "flex";
    this.iframeRef.instance.style.display = connected ? "block" : "none";
  }

  private onIframeLoad(): void {
    const iframe = this.iframeRef.instance;
    // Nur als connected werten wenn src eine echte coui-URL ist.
    // about:blank / leerer src soll den Fallback NICHT verstecken.
    if (iframe.src && iframe.src.startsWith("coui:")) {
      this.setConnected(true);
      this.clearReconnect();
    }
  }

  private onIframeError(): void {
    this.setConnected(false);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.tryConnect();
    }, RECONNECT_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public render(): TVNode<HTMLDivElement> {
    return (
      <div ref={this.gamepadUiViewRef} style={STYLE_ROOT}>
        <style>{STYLE_KEYFRAMES}</style>
        <iframe
          ref={this.iframeRef}
          style={STYLE_IFRAME}
          title="VoiceWalker"
        />
        <div ref={this.fallbackRef} style={STYLE_FALLBACK}>
          <img
            src={`${BASE_URL}/Assets/app-icon.svg`}
            alt="VoiceWalker"
            style={STYLE_LOGO}
          />
          <h2 style={STYLE_TITLE}>VoiceWalker</h2>
          <div style={STYLE_SPINNER} />
          <p style={STYLE_MSG}>
            Verbinde mit VoiceWalker-Backend&hellip;
          </p>
        </div>
      </div>
    );
  }
}
