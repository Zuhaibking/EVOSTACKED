import { injectInspectBridge } from '@/lib/inspect-bridge'
import {
  detectPackageManager,
  extraNpmPackages,
  installCommand,
  type PackageManager,
} from '@/lib/fragment-deps'
import {
  fragmentFiles,
  withMissingLocalModules,
  type WrittenFile,
} from '@/lib/fragment-files'
import { resolveImages } from '@/lib/images'
import { getModelClient, LLMModel, LLMModelConfig } from '@/lib/models'
import { FragmentSchema } from '@/lib/schema'
import {
  isStaticHtml,
  resolveSandboxPort,
  resolveSandboxTemplate,
} from '@/lib/templates'
import { ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'
import {
  CandidateHealth,
  filesFromModel,
  healCandidate,
  isBuildFailure,
  repairPrompt,
  type ProbeResult,
  type RepairContext,
} from '@/lib/verify'
import { Sandbox } from '@e2b/code-interpreter'
import { LanguageModel, generateText } from 'ai'

const sandboxTimeout = 10 * 60 * 1000 // 10 minute in ms

export const maxDuration = 180

export async function POST(req: Request) {
  const {
    fragment,
    userID,
    teamID,
    accessToken,
    model,
    config,
  }: {
    fragment: FragmentSchema
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
    model?: LLMModel
    config?: LLMModelConfig
  } = await req.json()
  console.log('fragment', fragment)
  console.log('userID', userID)
  // console.log('apiKey', apiKey)

  // Strip any "-dev" suffix the prompt-side template ids carry in development.
  // E2B's hosted templates don't have the suffix; the -dev convention only
  // applies if a user has published a *-dev custom template to their account.
  const sandboxTemplate = resolveSandboxTemplate(
    fragment.template,
    fragment.file_path,
  )

  // Create an interpreter or a sandbox
  const sbx = await Sandbox.create(sandboxTemplate, {
    metadata: {
      template: sandboxTemplate,
      userID: userID ?? '',
      teamID: teamID ?? '',
    },
    timeoutMs: sandboxTimeout,
    ...(teamID && accessToken
      ? {
          headers: {
            'X-Supabase-Team': teamID,
            'X-Supabase-Token': accessToken,
          },
        }
      : {}),
  })

  const sourceFiles = fragmentFiles(fragment)
  const npmPkgs = extraNpmPackages(
    sourceFiles,
    fragment.additional_dependencies,
  )
  const npmTemplate =
    sandboxTemplate === 'nextjs-developer' || sandboxTemplate === 'vue-developer'
  const healNext =
    sandboxTemplate === 'nextjs-developer' && !isStaticHtml(fragment)

  const imaged = await resolveImages(sourceFiles)
  let health: CandidateHealth | undefined
  let files = withMissingLocalModules(imaged.files)

  if (healNext) {
    for (const bin of imaged.binaries) {
      await sbx.files.write(bin.file_path, bin.data)
      console.log(`Copied image to ${bin.file_path} in ${sbx.sandboxId}`)
    }
    const present = await readInstalledPackages(sbx)
    const previewUrl = `https://${sbx.getHost(resolveSandboxPort(sandboxTemplate))}`
    const healed = await healCandidate({
      files: imaged.files,
      present,
      declared: fragment.additional_dependencies,
      label: fragment.title || sbx.sandboxId,
      log: (line) => console.log(line),
      install: (pkgs) => installMissing(sbx, pkgs),
      probe: async (nextFiles) => {
        await writeFiles(sbx, withMissingLocalModules(nextFiles))
        return probePreview(previewUrl)
      },
      llmRepair: (ctx) => repairWithModel(model, config, ctx),
    })
    health = healed.health
    files = withMissingLocalModules(healed.files)
    await writeFiles(sbx, files)
  } else {
    if (npmTemplate && npmPkgs.length) {
      const installed = await installMissing(sbx, npmPkgs)
      if (!installed.ok) {
        console.warn(
          `[deps] install failed (${npmPkgs.join(', ')})`,
          installed.output,
        )
      }
    } else if (!npmTemplate && fragment.has_additional_dependencies) {
      await sbx.commands.run(fragment.install_dependencies_command).then(() => {
        console.log(
          `Installed dependencies: ${fragment.additional_dependencies.join(', ')} in sandbox ${sbx.sandboxId}`,
        )
      })
    }
    await writeFiles(sbx, files)
    for (const bin of imaged.binaries) {
      await sbx.files.write(bin.file_path, bin.data)
      console.log(`Copied image to ${bin.file_path} in ${sbx.sandboxId}`)
    }
  }

  // Static HTML has no Next/Vue server. Mount it inside the running template
  // so preview uses the template port instead of a closed port 80.
  if (sandboxTemplate !== 'code-interpreter-v1' && isStaticHtml(fragment)) {
    const html =
      files.find((f) => /\.html?$/i.test(f.file_path))?.file_content ||
      files[0]?.file_content ||
      ''
    await sbx.files.write('public/generated.html', html)
    await sbx.files.write(
      'pages/index.tsx',
      `export default function Page() {
  return (
    <iframe
      src="/generated.html"
      title="preview"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none' }}
    />
  )
}
`,
    )
    console.log(`Mounted static HTML in ${sbx.sandboxId}`)
  }

  if (sandboxTemplate !== 'code-interpreter-v1') {
    try {
      await injectInspectBridge(sbx)
    } catch (e) {
      console.warn('inspect bridge inject failed', e)
    }
  }

  // Execute code or return a URL to the running sandbox
  if (sandboxTemplate === 'code-interpreter-v1') {
    const { logs, error, results } = await sbx.runCode(fragment.code || '')

    return new Response(
      JSON.stringify({
        sbxId: sbx?.sandboxId,
        template: sandboxTemplate,
        stdout: logs.stdout,
        stderr: logs.stderr,
        runtimeError: error,
        cellResults: results,
      } as ExecutionResultInterpreter),
    )
  }

  return new Response(
    JSON.stringify({
      sbxId: sbx?.sandboxId,
      template: sandboxTemplate,
      url: `https://${sbx?.getHost(resolveSandboxPort(sandboxTemplate))}`,
      health,
    } as ExecutionResultWeb),
  )
}

async function writeFiles(sbx: Sandbox, files: WrittenFile[]) {
  for (const file of files) {
    await sbx.files.write(file.file_path, file.file_content)
    console.log(`Copied file to ${file.file_path} in ${sbx.sandboxId}`)
  }
}

async function runCmd(sbx: Sandbox, cmd: string, timeoutMs: number) {
  const result = await sbx.commands.run(cmd, {
    timeoutMs,
    requestTimeoutMs: timeoutMs,
  })
  const rec = result as { stdout?: string; stderr?: string; exitCode?: number }
  return {
    ok: rec.exitCode == null || rec.exitCode === 0,
    stdout: rec.stdout || '',
    output: `${rec.stdout || ''}\n${rec.stderr || ''}`,
  }
}

async function readInstalledPackages(sbx: Sandbox): Promise<string[]> {
  try {
    const listed = await runCmd(
      sbx,
      `node -e "const p=require('./package.json'); process.stdout.write(Object.keys({...p.dependencies,...p.devDependencies}).join(','))"`,
      20_000,
    )
    return listed.stdout.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function readPackageManager(sbx: Sandbox): Promise<PackageManager | null> {
  try {
    const listed = await runCmd(
      sbx,
      `node -e "const fs=require('fs'); const locks=['pnpm-lock.yaml','yarn.lock','package-lock.json'].filter(f=>fs.existsSync(f)); let pm=''; try{pm=(require('./package.json').packageManager)||''}catch(e){} process.stdout.write(JSON.stringify({locks,pm}))"`,
      20_000,
    )
    const raw = listed.stdout || ''
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end < start) return null
    const info = JSON.parse(raw.slice(start, end + 1)) as {
      locks?: string[]
      pm?: string
    }
    const manager = detectPackageManager({
      packageManager: info.pm,
      lockfiles: info.locks,
    })
    console.log(`[deps] package manager: ${manager || 'conflict'}`)
    return manager
  } catch (e) {
    console.warn(
      '[deps] could not read package manager; not installing',
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

async function installMissing(sbx: Sandbox, packages: string[]) {
  const manager = await readPackageManager(sbx)
  if (!manager) {
    return {
      ok: false,
      output: 'refused to install: lockfiles conflict or package manager could not be read',
    }
  }
  const cmd = installCommand(manager, packages)
  if (!cmd) return { ok: true, output: '' }
  try {
    let result = await runCmd(sbx, cmd, 90_000)
    const peer =
      manager === 'npm'
        ? /ERESOLVE/i.test(result.output)
        : manager === 'pnpm'
          ? /ERR_PNPM_PEER_DEP/i.test(result.output)
          : false
    const retry = peer ? installCommand(manager, packages, true) : null
    if (!result.ok && retry) result = await runCmd(sbx, retry, 90_000)
    if (!result.ok) return result
    const check = packages.map((p) => `require.resolve(${JSON.stringify(p)})`).join(';')
    const resolved = await runCmd(sbx, `node -e ${JSON.stringify(check)}`, 20_000)
    if (!resolved.ok) {
      return { ok: false, output: `${result.output}\n${resolved.output}` }
    }
    console.log(
      `Installed dependencies with ${manager}: ${packages.join(', ')} in sandbox ${sbx.sandboxId}`,
    )
    return { ok: true, output: result.output }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

async function probePreview(url: string): Promise<ProbeResult> {
  let last = ''
  let status = 0
  await new Promise((r) => setTimeout(r, 1500))
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      status = res.status
      last = (await res.text()).slice(0, 8000)
      const runtime = /Application error|Unhandled Runtime/i.test(last)
      const compiling = /compiling/i.test(last) && last.length < 4000
      const starter = /Get started by editing|To get started, edit/i.test(last)
      if (res.ok && !isBuildFailure(last) && !runtime && !compiling && !starter && last.includes('<')) {
        return { ok: true, output: '', httpStatus: status, phase: 'preview' }
      }
      if ((isBuildFailure(last) || runtime) && i === 3) {
        return { ok: false, output: last, httpStatus: status, phase: 'preview' }
      }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return { ok: false, output: last || 'timeout', httpStatus: status, phase: 'preview' }
}

async function repairWithModel(
  model: LLMModel | undefined,
  config: LLMModelConfig | undefined,
  ctx: RepairContext,
): Promise<WrittenFile[] | null> {
  if (!model || !config) return null
  try {
    const { text } = await generateText({
      model: getModelClient(model, config) as LanguageModel,
      prompt: repairPrompt(ctx),
      maxRetries: 0,
      temperature: 0,
    })
    return filesFromModel(ctx.files, ctx.error, text)
  } catch (e) {
    console.warn(
      '[EvoStack][REPAIR] model unavailable',
      e instanceof Error ? e.message : e,
    )
    return null
  }
}
