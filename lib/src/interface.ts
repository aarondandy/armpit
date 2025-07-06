import { ArmpitCredentialProvider } from "./armpitCredential.js";
import { AzAccountTools } from "./accountTools.js";
import { ResourceGroupTools } from "./resourceGroupTools.js";
import { NetworkTools } from "./networkTools.js";
import { AzTemplateExpression } from "./azCliUtils.js";

export interface AzCliInvokable {
  <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]): Promise<T>;
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T | null>;
  // TODO: Expose env vars so somebody can use Execa or zx directly.
}

export interface AzGlobal extends ArmpitCredentialProvider {
  readonly group: ResourceGroupTools;
  readonly account: AzAccountTools;
}

export interface AzGlobalInterface extends AzGlobal, AzCliInvokable {
}

export interface AzLocationBound {
  readonly location: string;
}

export interface AzGroupBound extends AzLocationBound, ArmpitCredentialProvider {
  readonly name: string;
  readonly subscriptionId: string | null;
  readonly network: NetworkTools;
}

export interface AzGroupInterface extends AzGroupBound, AzCliInvokable {
}
