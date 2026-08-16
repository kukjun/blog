import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 글은 src/content/blog/{en,ko}/<slug>.md 로 둔다.
// entry id 예: "en/hello-world" → lang = "en", slug = "hello-world"
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    lang: z.enum(['en', 'ko']),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // 번역 짝을 잇는 키 (같은 값이면 en/ko가 서로의 번역)
    translationKey: z.string(),
  }),
});

export const collections = { blog };
