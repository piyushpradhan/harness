/// <reference types="vite/client" />

interface Window {
  api: {
    platform: string
    versions: {
      electron: string
      chrome: string
      node: string
    }
  }
}
interface Window {
  harness: {
    providers: { list(): Promise<Array<{ id: string; name: string }>> }
    auth: {
      set(id: string, key: string): Promise<void>
      has(id: string): Promise<boolean>
      test(id: string): Promise<boolean>
    }
  }
}
