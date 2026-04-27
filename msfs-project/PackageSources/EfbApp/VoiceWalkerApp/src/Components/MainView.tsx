import {
  GamepadUiView,
  RequiredProps,
  TVNode,
  UiViewProps,
} from "@efb/efb-api";
import { FSComponent, VNode } from "@microsoft/msfs-sdk";

declare const BASE_URL: string;

const BACKEND_URL = "http://127.0.0.1:7801/";
const RECONNECT_MS = 4000;

interface MainViewProps extends RequiredProps<UiViewProps, "appViewService"> {}

// Inline-Styles statt CSS-Klassen, damit das Layout nicht vom esbuild-
// SCSS-Prefix-Selector abhaengig ist (der Prefix passt nicht zwingend zur
// EFB-Container-Klasse, was zu broken Layout fuehrt).
const STYLE_ROOT = `position: absolute; inset: 0; display: flex;
  flex-direction: column; align-items: center; justify-content: center;
  background-color: #0d1a2b; color: #e8eef5; padding: 2rem; gap: 1.4rem;
  text-align: center; overflow: hidden;`;

const STYLE_IFRAME = `position: absolute; inset: 0; width: 100%;
  height: 100%; border: none; background: transparent; display: none;`;

const STYLE_FALLBACK = `position: absolute; inset: 0; display: flex;
  flex-direction: column; align-items: center; justify-content: center;
  background-color: #0d1a2b; color: #e8eef5; padding: 2rem; gap: 1.4rem;
  text-align: center;`;

const STYLE_LOGO = `display: block; max-width: 200px; width: 60%;
  height: auto; object-fit: contain;`;

const STYLE_TITLE = `font-size: 1.6rem; font-weight: 600; margin: 0;
  letter-spacing: 0.02em;`;

const STYLE_MSG = `font-size: 1rem; opacity: 0.85; margin: 0;`;

const STYLE_SPINNER = `width: 36px; height: 36px;
  border: 3px solid rgba(232,238,245,0.2);
  border-top: 3px solid #3fdc8a; border-radius: 50%;
  animation: vw-efb-spin 1s linear infinite;`;

// Keyframes muessen im DOM landen — als <style>-Tag im View injizieren.
const STYLE_KEYFRAMES = `@keyframes vw-efb-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}`;

export class MainView extends GamepadUiView<HTMLDivElement, MainViewProps> {
  public readonly tabName = "MainView";

  private iframeRef = FSComponent.createRef<HTMLIFrameElement>();
  private fallbackRef = FSComponent.createRef<HTMLDivElement>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    const iframe = this.iframeRef.instance;
    iframe.addEventListener("load", () => this.onIframeLoad());
    iframe.addEventListener("error", () => this.onIframeError());
    this.connect();
  }

  private connect(): void {
    this.iframeRef.instance.src = `${BACKEND_URL}?t=${Date.now()}`;
  }

  private onIframeLoad(): void {
    const iframe = this.iframeRef.instance;
    if (iframe.src && iframe.src.startsWith("http")) {
      this.fallbackRef.instance.style.display = "none";
      iframe.style.display = "block";
      this.clearReconnect();
    }
  }

  private onIframeError(): void {
    this.fallbackRef.instance.style.display = "flex";
    this.iframeRef.instance.style.display = "none";
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
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
        <iframe ref={this.iframeRef} style={STYLE_IFRAME} title="VoiceWalker" />
        <div ref={this.fallbackRef} style={STYLE_FALLBACK}>
          <img
            src={`${BASE_URL}/Assets/app-icon.svg`}
            alt="VoiceWalker"
            style={STYLE_LOGO}
          />
          <h2 style={STYLE_TITLE}>VoiceWalker</h2>
          <div style={STYLE_SPINNER} />
          <p style={STYLE_MSG}>
            Verbindung zum VoiceWalker-Backend wird hergestellt&hellip;
          </p>
        </div>
      </div>
    );
  }
}
