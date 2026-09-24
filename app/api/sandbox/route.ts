import { injectInspectBridge } from '@/lib/inspect-bridge'
import { extraNpmPackages, npmInstallCommand } from '@/lib/fragment-deps'
import {
  fragmentFiles,
  withMissingLocalModules,
} from '@/lib/fragment-files'
import { resolveImages } from '@/lib/images'
import { FragmentSchema } from '@/lib/schema'
import {
  isStaticHtml,
  resolveSandboxPort,
  resolveSandboxTemplate,
} from '@/lib/templates'
import { ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'
import { Sandbox } from '@e2b/code-interpreter'

const sandboxTimeout = 10 * 60 * 1000 // 10 minute in ms

export const maxDuration = 60

export async function POST(req: Request) {
  const {
    fragment,
    userID,
    teamID,
    accessToken,
  }: {
    fragment: FragmentSchema
    userID: string | undefined
    teamID: string | undefined
    accessToken: string | undefined
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
  const installCmd = npmInstallCommand(npmPkgs)
  const npmTemplate =
    sandboxTemplate === 'nextjs-developer' || sandboxTemplate === 'vue-developer'

  // Copy code to fs (plus any local modules the entry file imported but omitted)
  const imagedP = resolveImages(sourceFiles)
  const installP =
    npmTemplate && installCmd
      ? sbx.commands
          .run(installCmd, { timeoutMs: 90_000, requestTimeoutMs: 90_000 })
          .then(() => {
            console.log(
              `Installed dependencies: ${npmPkgs.join(', ')} in sandbox ${sbx.sandboxId}`,
            )
          })
          .catch((e) => {
            console.warn(
              `[deps] npm install failed (${npmPkgs.join(', ')})`,
              e instanceof Error ? e.message : e,
            )
          })
      : !npmTemplate && fragment.has_additional_dependencies
        ? sbx.commands.run(fragment.install_dependencies_command).then(() => {
            console.log(
              `Installed dependencies: ${fragment.additional_dependencies.join(', ')} in sandbox ${sbx.sandboxId}`,
            )
          })
        : Promise.resolve()

  const imaged = (await Promise.all([imagedP, installP]))[0]
  const files = withMissingLocalModules(imaged.files)
  for (const file of files) {
    await sbx.files.write(file.file_path, file.file_content)
    console.log(`Copied file to ${file.file_path} in ${sbx.sandboxId}`)
  }
  for (const bin of imaged.binaries) {
    await sbx.files.write(bin.file_path, bin.data)
    console.log(`Copied image to ${bin.file_path} in ${sbx.sandboxId}`)
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
    } as ExecutionResultWeb),
  )
}
