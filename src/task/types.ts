import type { Frontmatter } from './frontmatter'

export type TaskDefinition = Frontmatter & {
  prompt: string
}
