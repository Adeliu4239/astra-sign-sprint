import { z } from "zod";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Files above this go through chunked upload (Vercel limits request bodies to ~4.5 MB). */
export const SINGLE_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_PAGES = 300;
export const MAX_FIELDS = 60;
export const MAX_SIGNATURE_PNG_BYTES = 600 * 1024;

export const createCaseSchema = z.object({
  title: z.string({ error: "Case title is required" }).trim().min(1, "Case title is required").max(120, "Case title is too long"),
  clientName: z.string({ error: "Client name is required" }).trim().min(1, "Client name is required").max(120, "Client name is too long"),
  clientEmail: z.string({ error: "Client email is required" }).trim().toLowerCase().email("Enter a valid client email").max(200),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

const unit = z.number().finite().min(0).max(1);
const EPS = 1e-6;

export const fieldSchema = z
  .object({
    kind: z.enum(["signature", "name", "date"]),
    pageIndex: z.number().int().min(0),
    x: unit,
    y: unit,
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
  })
  .refine((f) => f.x + f.width <= 1 + EPS && f.y + f.height <= 1 + EPS, {
    message: "Field must be inside the page",
  });
export type FieldInput = z.infer<typeof fieldSchema>;

export const saveFieldsSchema = z.object({
  fields: z.array(fieldSchema).max(MAX_FIELDS, `At most ${MAX_FIELDS} fields`),
});

export const submitSignatureSchema = z.object({
  consent: z.literal(true, { message: "You must agree to sign electronically" }),
  signerName: z.string({ error: "Enter your full name" }).trim().min(1, "Enter your full name").max(120, "Name is too long"),
  method: z.enum(["drawn", "typed"]),
  signaturePng: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Signature image is invalid")
    .max(Math.ceil((MAX_SIGNATURE_PNG_BYTES * 4) / 3) + 32, "Signature image is too large"),
});
export type SubmitSignatureInput = z.infer<typeof submitSignatureSchema>;

export const CONSENT_TEXT =
  "I agree to use electronic records and signatures for this document. I have reviewed the document, and I intend my electronic signature to have the same effect as my handwritten signature.";

export const startUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().max(100).default("application/pdf"),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, `The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`),
});
