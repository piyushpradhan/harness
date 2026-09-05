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
