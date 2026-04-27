import {
  GamepadUiView,
  RequiredProps,
  TVNode,
  UiViewProps,
} from "@efb/efb-api";
import { FSComponent, VNode } from "@microsoft/msfs-sdk";
import "./MainView.scss";

declare const BASE_URL: string;

const BACKEND_URL = "http://127.0.0.1:7801/";
const RECONNECT_MS = 4000;

interface MainViewProps extends RequiredProps<UiViewProps, "appViewService"> {}

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
      <div ref={this.gamepadUiViewRef} class="vw-main-view">
        <iframe
          ref={this.iframeRef}
          class="vw-iframe"
          title="VoiceWalker"
          style="display: none"
        />
        <div ref={this.fallbackRef} class="vw-fallback">
          <img
            src={`${BASE_URL}/Assets/app-icon.svg`}
            alt="VoiceWalker"
            class="vw-fallback-logo"
          />
          <div class="vw-spinner" />
          <span class="vw-fallback-message">
            Waiting for VoiceWalker server&hellip;
          </span>
        </div>
      </div>
    );
  }
}
