import { SubmissionsAdmin } from '@/components/submissions-admin'

export default function ProjectSubmissionsPage({
  params,
}: {
  params: { projectId: string }
}) {
  return <SubmissionsAdmin projectId={params.projectId} />
}
