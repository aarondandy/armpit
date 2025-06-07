import { az } from "armpit";
import { loadMyEnvironment } from "./myConfig.js";

const targetEnvironment = await loadMyEnvironment("samples");
await az.account.setOrLogin(targetEnvironment);

throw new Error("Coming soon!");
