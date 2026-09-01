import { z } from "zod";

const responseSchema = z.looseObject({
  output: z.array(z.unknown()).optional(),
});
const eventSchema = z.looseObject({
  item: z.unknown().optional(),
  response: z.unknown().optional(),
  type: z.string(),
});
const sourceSchema = z.looseObject({
  caption: z.string().optional(),
  title: z.string().optional(),
  url: z.string(),
});
const sourceCandidateSchema = z.union([
  sourceSchema,
  z.looseObject({ url_citation: sourceSchema }).transform(({ url_citation }) => url_citation),
]);
const messageItemSchema = z.looseObject({
  content: z.array(
    z.looseObject({
      annotations: z.array(sourceCandidateSchema).optional(),
      text: z.string().optional(),
    }),
  ),
  type: z.literal("message"),
});
const webSearchItemSchema = z.looseObject({
  action: z.looseObject({ sources: z.array(sourceCandidateSchema).optional() }).optional(),
  sources: z.array(sourceCandidateSchema).optional(),
  type: z.literal("web_search_call"),
});
const jwtPayloadSchema = z.looseObject({
  "https://api.openai.com/auth": z
    .looseObject({ chatgpt_account_id: z.string().optional() })
    .optional(),
});

type ParsedResponse = z.infer<typeof responseSchema>;
type SourceCandidate = z.infer<typeof sourceSchema>;

export { eventSchema, jwtPayloadSchema, messageItemSchema, responseSchema, webSearchItemSchema };
export type { ParsedResponse, SourceCandidate };
