import type { ArmpitCredentialProvider } from "./armpitCredential.js";
import type { AccountTools } from "./accountTools.js";
import type { ResourceGroupTools } from "./resourceGroupTools.js";
import type { AppServiceTools } from "./appServiceTools.js";
import type { ContainerAppTools } from "./containerAppTools.js";
import type { ComputeTools } from "./computeTools.js";
import type { NetworkTools } from "./networkTools.js";
import type { AzCliInvoker } from "./azCliInvoker.js";

export interface AzLocationBound {
  readonly location: string;
}

export interface AzGroupBound extends AzLocationBound {
  readonly name: string;
  readonly subscriptionId: string | null;
}

export interface AzGlobalTools extends ArmpitCredentialProvider {
  readonly group: ResourceGroupTools;
  readonly account: AccountTools;
}

export interface AzGroupTools extends AzGroupBound, ArmpitCredentialProvider {
  readonly appService: AppServiceTools;
  readonly containerApp: ContainerAppTools;
  readonly compute: ComputeTools;
  readonly network: NetworkTools;
}

export interface AzGlobalProvider extends AzGlobalTools, AzCliInvoker {}

export interface AzGroupProvider extends AzGroupTools, AzCliInvoker {}
