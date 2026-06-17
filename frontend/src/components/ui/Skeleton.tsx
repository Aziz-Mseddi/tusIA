import { clsx } from 'clsx'

interface SkeletonProps {
  className?: string
}

/** Shimmering placeholder block for content that is still loading. */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={clsx('skeleton', className)} aria-hidden />
}

/** A stack of skeleton lines approximating a loading list row / card. */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={clsx('border border-white/[0.06] p-6 space-y-4', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-3 rounded-full" />
      </div>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}
