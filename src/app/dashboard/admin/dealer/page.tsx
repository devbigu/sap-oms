'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DealerPage() {
  const router = useRouter()
  
  useEffect(() => {
    router.replace('/dashboard/admin/dealer/DealerList')
  }, [router])
  
  return null
}
