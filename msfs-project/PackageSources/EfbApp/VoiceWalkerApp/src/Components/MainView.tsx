import {
  GamepadUiView,
  RequiredProps,
  TVNode,
  UiViewProps,
} from "@efb/efb-api";
import { FSComponent, VNode } from "@microsoft/msfs-sdk";
import "./MainView.scss";

declare const BASE_URL: string;

interface MainViewProps extends RequiredProps<UiViewProps, "appViewService"> {}

// Diagnose-Variante: nur statisches Layout, kein iframe.
// Wenn das im EFB sichtbar ist, wissen wir dass die View-Pipeline OK ist
// und das vorherige iframe-Pattern von Coherent GT silent geblockt wurde.
// Iframe-Variante kommt zurueck sobald wir wissen wie Coherent das erlaubt
// (vermutlich via WebSocket-RPC direkt aus dem JS, statt iframe gegen
// http://localhost).
export class MainView extends GamepadUiView<HTMLDivElement, MainViewProps> {
  public readonly tabName = "MainView";

  public onAfterRender(node: VNode): void {
    super.onAfterRender(node);
    console.log("[VoiceWalker EFB] MainView mounted, BASE_URL=", BASE_URL);
  }

  public render(): TVNode<HTMLDivElement> {
    return (
      <div ref={this.gamepadUiViewRef} class="vw-main-view">
        <div class="vw-fallback">
          <img
            src={`${BASE_URL}/Assets/app-icon.svg`}
            alt="VoiceWalker"
            class="vw-fallback-logo"
          />
          <h2 class="vw-title">VoiceWalker</h2>
          <span class="vw-fallback-message">
            EFB-App geladen. Backend-Verbindung folgt.
          </span>
        </div>
      </div>
    );
  }
}
