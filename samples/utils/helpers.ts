import fs from "node:fs";
import archiver from "archiver";

export async function zipFolder(folderPath: string, archivePath: string) {
  const outStream = fs.createWriteStream(archivePath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(outStream);
  archive.directory(folderPath, false);
  await new Promise((resolve, reject) => {
    outStream.on("close", () => resolve(1));
    archive.on("error", err => reject(err));
    archive.finalize();
  });
}
