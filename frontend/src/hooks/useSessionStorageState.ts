import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export function useSessionStorageState<T extends string>(
  storageKey: string,
  initialValue: T | (() => T),
  getStorageValue?: (value: T) => string,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue)
  const valueToStore = getStorageValue ? getStorageValue(value) : value

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.sessionStorage.setItem(storageKey, valueToStore)
  }, [storageKey, valueToStore])

  return [value, setValue]
}
