import {
  GamepadUiView,
  RequiredProps,
  TVNode,
  UiViewProps,
} from "@efb/efb-api";
import { FSComponent, VNode } from "@microsoft/msfs-sdk";

declare const BASE_URL: string;

// Same-origin coui:// statt http://localhost — Coherent GT im EFB blockt
// http-iframes silent. Die Web-UI wird via build.js ins EFB-Bundle
// mitkopiert (./dist/web/) und liegt dann unter BASE_URL/web/index.html.
// Sie verbindet sich von dort aus via WebSocket zu localhost:7801.
const BACKEND_URL = `${BASE_URL}/web/index.html`;
const RECONNECT_MS = 4000;

interface MainViewProps extends RequiredProps<UiViewProps, "appViewService"> {}

// Inline-Styles statt CSS-Klassen (esbuild-Prefix matched die EFB-
// Container-Klasse nicht zuverlaessig). Pattern analog zur GSim-Kneeboard-
// EFB-App: iframe gegen lokalen HTTP-Server, Spinner-Fallback solange
// nicht connected. Kein auto-hide bei onLoad ohne valide src — sonst
// versteckt sich der Fallback bei about:blank-Loads und der User sieht
// nur Schwarz.
const STYLE_ROOT = `position: absolute; inset: 0; background-color: #0d1a2b;
  overflow: hidden;`;

const STYLE_IFRAME = `position: absolute; inset: 0; width: 100%;
  height: 100%; border: none; background: transparent; display: none;`;

const STYLE_FALLBACK = `position: absolute; inset: 0; display: flex;
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
    // Nur als connected werten wenn src eine echte http-URL ist.
    // about:blank / leerer src soll den Fallback NICHT verstecken.
    if (iframe.src && iframe.src.startsWith("http")) {
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
