import { ArmpitCredentialProvider } from "./armpitCredential.js";
import { AzAccountTools } from "./azAccountTools.js";
import { AzGroupTools } from "./azGroupTools.js";
import { AzNsgTools } from "./azNsgTools.js";
import { AzTemplateExpression } from "./azCliUtils.js";

export interface AzCliInvokable {
  <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]): Promise<T>;
  strict: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T>;
  lax: <T>(templates: TemplateStringsArray, ...expressions: readonly AzTemplateExpression[]) => Promise<T | null>;
  // TODO: Expose env vars so somebody can use Execa or zx directly.
}

export interface AzGlobal extends ArmpitCredentialProvider {
  readonly group: AzGroupTools;
  readonly account: AzAccountTools;
}

export interface AzGlobalInterface extends AzGlobal, AzCliInvokable {
}

export interface AzLocationBound {
  readonly location: string;
}

export interface AzGroupBound extends AzLocationBound, ArmpitCredentialProvider {
  readonly name: string;
  readonly subscriptionId?: string;
  readonly nsg: AzNsgTools;
}

export interface AzGroupInterface extends AzGroupBound, AzCliInvokable {
}
