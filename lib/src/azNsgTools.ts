import { CallableClassBase } from "./utils.js";
import { handleGet } from "./sdkTools.js";
import type { CliInvokers } from "./invoker.js";
import type { NetworkSecurityGroup, SecurityRule } from "@azure/arm-network";
import { AzureCliCredential } from "@azure/identity";
import { NetworkManagementClient } from "@azure/arm-network";

interface AzNsgToolsContext {
  groupName?: string,
  location?: string,
  subscriptionId?: string | null,
}

export interface SecurityRuleDescriptor extends Omit<SecurityRule, "etag" | "type" | "provisioningState"> {
  direction: "Inbound" | "Outbound",
  priority: number,
  access: "Allow" | "Deny",
  protocol: "Tcp" | "Udp" | "Icmp" | "Esp" | "*" | "Ah",
};

interface AzNsgUpsertOptions {
  rules?: SecurityRuleDescriptor[],
  deleteUnknownRules?: boolean,
  groupName?: string,
  location?: string,
}

export interface AzNsgTools {
  (name: string, options?: AzNsgUpsertOptions): Promise<NetworkSecurityGroup>;
}

function ensureRuleOptionsSet(rule: SecurityRule) {
  if (!rule.protocol) {
    rule.protocol = "*";
  }

  if (!rule.sourceAddressPrefix && !rule.sourceAddressPrefixes && !rule.sourceApplicationSecurityGroups) {
    rule.sourceAddressPrefix = "*";
  }

  if (!rule.sourcePortRange && !rule.sourcePortRanges) {
    rule.sourcePortRange = "*";
  }

  if (!rule.destinationAddressPrefix && !rule.destinationAddressPrefixes && !rule.destinationApplicationSecurityGroups) {
    rule.destinationAddressPrefix = "*";
  }

  if (!rule.destinationPortRange && !rule.destinationPortRanges) {
    rule.destinationPortRange = "*";
  }
}

export class AzNsgTools extends CallableClassBase implements AzNsgTools {

  #invokers: CliInvokers;
  #context: AzNsgToolsContext;

  constructor(invokers: CliInvokers, context: AzNsgToolsContext) {
    super();
    this.#invokers = invokers;
    this.#context = context;
  }

  protected async fnImpl(name: string, options?: AzNsgUpsertOptions) {
    const subscriptionId = this.#context.subscriptionId ?? undefined;
    const credential = new AzureCliCredential({
      subscription: subscriptionId,
    });
    const client = subscriptionId
      ? new NetworkManagementClient(credential, subscriptionId)
      : new NetworkManagementClient(credential);

    let nsg: NetworkSecurityGroup | null = null;
    let groupName = options?.groupName ?? this.#context.groupName;
    if (groupName != null) {
      try {
        nsg = await handleGet(client.networkSecurityGroups.get(groupName, name));
      } catch {
        nsg = await this.#invokers.lax<NetworkSecurityGroup>`network nsg show -n ${name} -g ${groupName}`;
      }
    } else {
      nsg = await this.#invokers.lax<NetworkSecurityGroup>`network nsg show -n ${name}`;
    }

    let desiredRules = options?.rules?.map(d => {
      const result = { ...d };
      ensureRuleOptionsSet(result);
      return result;
    }) ?? [];

    if (!nsg) {
      nsg = {
        name,
        location: options?.groupName ?? this.#context.location,
        securityRules: desiredRules,
      }
    } else {
      let existingRules = nsg.securityRules == null ? [] : [... nsg.securityRules];
      let upsertRules: SecurityRule[] = [];

      for (let desiredIndex = 0; desiredIndex < desiredRules.length; ) {
        const desired = desiredRules[desiredIndex];
        const existingIndex = existingRules.findIndex(e => e.name === desired.name && e.direction === desired.direction);
        const existing = existingIndex >= 0 ? existingRules[existingIndex] : null;
        if (existing == null) {
          desiredIndex++;
        } else {
          desiredRules.splice(desiredIndex, 1);
          existingRules.splice(existingIndex, 1);
          upsertRules.push({
            ...desired,
            etag: existing.etag,
            type: existing.type,
          });
        }
      }

      if (!(options?.deleteUnknownRules)) {
        upsertRules.push(...existingRules);
      }

      upsertRules.push(...desiredRules);

      nsg.securityRules = upsertRules;
    }

    if (groupName == null) {
      throw new Error("A group name is required to create or update an NSG")
    }

    nsg = await client.networkSecurityGroups.beginCreateOrUpdateAndWait(
      groupName,
      name,
      nsg
    );
    return nsg;
  }
}
