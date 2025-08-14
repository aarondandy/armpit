import { ArmpitCredentialProvider } from "./armpitCredential.js";
import { AccountTools } from "./accountTools.js";
import { ResourceGroupTools } from "./resourceGroupTools.js";
import { AppServiceTools } from "./appServiceTools.js";
import { ContainerAppTools } from "./containerAppTools.js";
import { ComputeTools } from "./computeTools.js";
import { NetworkTools } from "./networkTools.js";
import { AzCliInvoker } from "./azCliInvoker.js";

export interface AzGlobal extends ArmpitCredentialProvider {
  readonly group: ResourceGroupTools;
  readonly account: AccountTools;
}

export interface AzGlobalInterface extends AzGlobal, AzCliInvoker {}

export interface AzLocationBound {
  readonly location: string;
}

export interface AzGroupBound extends AzLocationBound, ArmpitCredentialProvider {
  readonly name: string;
  readonly subscriptionId: string | null;
  readonly appService: AppServiceTools;
  readonly containerApp: ContainerAppTools;
  readonly compute: ComputeTools;
  readonly network: NetworkTools;
}

export interface AzGroupInterface extends AzGroupBound, AzCliInvoker {}
