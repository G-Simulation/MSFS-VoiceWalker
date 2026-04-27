import {
  App,
  AppBootMode,
  AppInstallProps,
  AppSuspendMode,
  AppView,
  AppViewProps,
  Efb,
  RequiredProps,
  TVNode,
} from "@efb/efb-api";
import { FSComponent, VNode } from "@microsoft/msfs-sdk";
import { MainView } from "./Components/MainView";

import "./VoiceWalkerApp.scss";

declare const BASE_URL: string;

class VoiceWalkerAppView extends AppView<RequiredProps<AppViewProps, "bus">> {
  protected defaultView = "MainView";

  protected registerViews(): void {
    this.appViewService.registerPage("MainView", () => (
      <MainView appViewService={this.appViewService} />
    ));
  }

  public render(): VNode {
    return <div class="msfs-voicewalker-app">{super.render()}</div>;
  }
}

class VoiceWalkerApp extends App {
  public get name(): string {
    return "VoiceWalker";
  }

  public get icon(): string {
    return `${BASE_URL}/Assets/app-icon.svg`;
  }

  public BootMode = AppBootMode.COLD;
  public SuspendMode = AppSuspendMode.SLEEP;

  public async install(_props: AppInstallProps): Promise<void> {
    Efb.loadCss(`${BASE_URL}/VoiceWalkerApp.css`);
    return Promise.resolve();
  }

  public get compatibleAircraftModels(): string[] | undefined {
    return undefined;
  }

  public render(): TVNode<VoiceWalkerAppView> {
    return <VoiceWalkerAppView bus={this.bus} />;
  }
}

Efb.use(VoiceWalkerApp);
