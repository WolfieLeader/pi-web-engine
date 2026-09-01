import { Type, type Static } from "typebox";

const sourceSchema = Type.Object(
  {
    caption: Type.Optional(Type.String()),
    ref_id: Type.Optional(Type.String()),
    snippet: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    url: Type.String(),
  },
  { additionalProperties: true },
);

const searchResponseSchema = Type.Object(
  {
    encrypted_output: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    output: Type.String(),
    results: Type.Optional(Type.Union([Type.Array(Type.Unknown()), Type.Null()])),
  },
  { additionalProperties: true },
);

const jwtPayloadSchema = Type.Object(
  {
    "https://api.openai.com/auth": Type.Optional(
      Type.Object(
        { chatgpt_account_id: Type.Optional(Type.String()) },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);

type SourceCandidate = Static<typeof sourceSchema>;

export { jwtPayloadSchema, searchResponseSchema, sourceSchema };
export type { SourceCandidate };
