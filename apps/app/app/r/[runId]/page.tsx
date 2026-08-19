import { PublicShareView } from './public-share-view'
import { getPublicRunShare } from '@/lib/api/client'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'EvoStack tournament',
  robots: { index: false, follow: false },
}

export default async function PublicRunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  if (!runId?.trim()) notFound()
  const data = await getPublicRunShare(runId).catch(() => null)
  if (!data) notFound()
  return <PublicShareView data={data} />
}
