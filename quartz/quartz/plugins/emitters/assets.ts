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

// If git-lfs isn't installed wherever this build runs, LFS-tracked files
// under md-notebook/ resolve to this ~130-byte pointer stub instead of the
// real bytes — fail loudly here instead of feeding it to sharp or shipping
// it as a "broken image" (see IMAGE-OPTIMIZATION-PLAN.md, #28).
const lfsPointerSignature = "version https://git-lfs.github.com/spec/v1"

async function assertNotLfsPointer(src: FilePath): Promise<void> {
  const fd = await fs.promises.open(src, "r")
  try {
    const buf = Buffer.alloc(lfsPointerSignature.length)
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0)
    if (buf.subarray(0, bytesRead).toString("utf8") === lfsPointerSignature) {
      throw new Error(
        `${src} is an unresolved Git LFS pointer, not real file data. ` +
          "Install git-lfs and make sure `git lfs pull` ran before building (see DEPLOY.md).",
      )
    }
  } finally {
    await fd.close()
  }
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
        await assertNotLfsPointer(src)

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
