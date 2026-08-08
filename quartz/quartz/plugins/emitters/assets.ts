import { FilePath, joinSegments, slugifyFilePath, withCompressedImageExt } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import path from "path"
import fs from "fs"
import sharp from "sharp"
import { glob } from "../../util/glob"
import DepGraph from "../../depgraph"
import { Argv } from "../../util/ctx"
import { QuartzConfig } from "../../cfg"

const filesToCopy = async (argv: Argv, cfg: QuartzConfig) => {
  // glob all non MD files in content folder and copy it over
  return await glob("**", argv.directory, ["**/*.md", ...cfg.configuration.ignorePatterns])
}

// Resize target for compressible images (see withCompressedImageExt); mirrors
// the ~1600-2000px guidance in IMAGE-OPTIMIZATION-PLAN.md.
const maxImageWidth = 1800

function outputName(fp: FilePath): FilePath {
  const ext = path.extname(withCompressedImageExt(fp))
  return (slugifyFilePath(fp, true) + ext) as FilePath
}

export const Assets: QuartzEmitterPlugin = () => {
  return {
    name: "Assets",
    async getDependencyGraph(ctx, _content, _resources) {
      const { argv, cfg } = ctx
      const graph = new DepGraph<FilePath>()

      const fps = await filesToCopy(argv, cfg)

      for (const fp of fps) {
        const src = joinSegments(argv.directory, fp) as FilePath
        const dest = joinSegments(argv.output, outputName(fp as FilePath)) as FilePath

        graph.addEdge(src, dest)
      }

      return graph
    },
    async *emit({ argv, cfg }, _content, _resources) {
      const assetsPath = argv.output
      const fps = await filesToCopy(argv, cfg)
      for (const fp of fps) {
        const src = joinSegments(argv.directory, fp) as FilePath
        const dest = joinSegments(assetsPath, outputName(fp as FilePath)) as FilePath
        const dir = path.dirname(dest) as FilePath
        await fs.promises.mkdir(dir, { recursive: true }) // ensure dir exists

        if (withCompressedImageExt(fp) !== fp) {
          await sharp(src)
            .resize({ width: maxImageWidth, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(dest)
        } else {
          await fs.promises.copyFile(src, dest)
        }
        yield dest
      }
    },
  }
}
