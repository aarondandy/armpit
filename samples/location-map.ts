import { az } from "armpit";

let currentAccount = await az.account.show() ?? await az.account.login();
if (!currentAccount) {
  throw new Error("Account required");
}

const locations = await az.account.listLocations();
const mapPins = locations
  .filter(loc => loc.metadata && loc.metadata.latitude && loc.metadata.longitude) // not all locations have coordinates
  .map(loc => ({ name: loc.displayName, lat: parseFloat(loc.metadata!.latitude!), lon: parseFloat(loc.metadata!.longitude!) })) // convert from string values
  .filter(loc => loc.lat || loc.lon); // exclude null or 0,0 locations

console.log(`${mapPins.length} locations:`);
for (let pin of mapPins) {
  console.log(` * ${pin.name} (${pin.lat}, ${pin.lon})`);
}
console.log("");

// draw the location pins on a map 🗺️📌
const symbols = [..." .oO@"];
const cellSize = 10;
const cellCount = 1 + Math.round(360.0 / cellSize);
const mapPinsByCell = mapPins.map(pin => ({ lat: Math.round(pin.lat / cellSize), lon: Math.round(pin.lon / cellSize) }));
const title = " Available Location Map ";
const titlePadding = Math.max(cellCount - title.length, 0);
console.log(`+-${'-'.repeat(Math.round(titlePadding/2))}${title}${'-'.repeat(titlePadding - Math.round(titlePadding/2))}-+`);
for (let lat = Math.round(70/cellSize); lat >= Math.round(-50/cellSize); lat--) {
  const lonValues = mapPinsByCell.filter(pin => pin.lat === lat).map(pin => pin.lon);
  let latLine = "| ";
  for (let lon = Math.round(-180/cellSize); lon <= Math.round(180/cellSize); lon++) {
    const positionLocations = lonValues.filter(x => x == lon);
    latLine += symbols[Math.min(symbols.length - 1, positionLocations.length)];
  }

  console.log(latLine + " |");
}
console.log(`+-${'-'.repeat(cellCount)}-+`);
