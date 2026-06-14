import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { fetchOverpassPins } from "./beacon";

const bboxSchema = z.object({
  south: z.number(),
  west: z.number(),
  north: z.number(),
  east: z.number(),
});

export const getOverpassPins = createServerFn({ method: "POST" })
  .inputValidator(bboxSchema)
  .handler(async ({ data }) => fetchOverpassPins(data));