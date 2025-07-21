import { setTimeout as sleep } from "node:timers/promises";
import { az, NameHash } from "armpit";
import { loadMyEnvironment } from "./utils/state.js";
import type { SBNamespace, SBQueue } from "@azure/arm-servicebus";
import { ServiceBusClient, type ServiceBusError } from "@azure/service-bus";

const targetEnvironment = await loadMyEnvironment("samples");
const targetLocation = targetEnvironment.defaultLocation ?? "centralus";
await az.account.setOrLogin(targetEnvironment);
const myUser = await az.account.showSignedInUser();

const rg = await az.group(`samples-${targetLocation}`, targetLocation);
const resourceHash = new NameHash(targetEnvironment.subscriptionId, { defaultLength: 6 }).concat(rg.name);

console.log("Preparing servicebus resources...");
const namespace = await rg<SBNamespace>`servicebus namespace create -n sb-sample-${resourceHash} --sku basic`;
console.log(`namespace ${namespace.name} created: ${namespace.serviceBusEndpoint}`);

const queue = await rg<SBQueue>`servicebus queue create --name stuff --namespace-name ${namespace.name}`;
console.log(`${namespace.name}/queues/${queue.name} created`);

for (const roleName of ["Azure Service Bus Data Receiver", "Azure Service Bus Data Sender"]) {
  await az`role assignment create --assignee ${myUser.userPrincipalName} --role ${roleName} --scope ${namespace.id}`;
}

const connectionString = `Endpoint=sb://${new URL(namespace.serviceBusEndpoint!).host};`;
console.log(connectionString);

const client = new ServiceBusClient(new URL(namespace.serviceBusEndpoint!).host, rg.getCredential());
try {
  const senderPromise = (async () => {
    const sender = client.createSender(queue.name!);
    try {
      for (const noise of ["chirp", "tweet", "squawk"]) {
        const batch = Array.from({ length: 5 }, () => ({ body: noise }));
        await sender.sendMessages(batch);
        console.log(`sent ${batch.length} ${noise} messages`);
      }
    } finally {
      await sender.close();
    }
  })();

  const receiveMessages = async () => {
    const receiver = client.createReceiver(queue.name!, { receiveMode: "peekLock" });
    try {
      receiver.subscribe({
        processMessage: async m => console.log("received", m.enqueuedTimeUtc, m.body),
        processError: async e => {
          if ((e?.error as ServiceBusError)?.code === "UnauthorizedAccess") {
            console.log("Unauthorized access probably means things are still warming up. Hopefully...", e);
          } else {
            console.log("OOPS!", e);
          }
        },
      });

      await senderPromise; // Wait until sending has completed...
      await sleep(3000); // and then some more because things can be slow.
    } finally {
      await receiver.close();
    }
  };
  const receivers = Array.from({ length: 3 }, () => receiveMessages());

  await Promise.all([...receivers, senderPromise]);
} finally {
  await client.close();
}
