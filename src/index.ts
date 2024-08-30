import express, { Request, Response } from 'express';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('[SERVER]: Project Setup !');
});

app.listen(port, () => {
  console.log(`[SERVER]: Server is running at PORT: ${port}`);
});

const measurementSchema = z.object({
    image: z.string(),
    customer_code: z.string(),
    measure_datetime: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid date format",
    }),
    measure_type: z.enum(['WATER', 'GAS'])
});

interface Measurement {
    image: string;
    customer_code: string;
    measure_datetime: string;
    measure_type: 'WATER' | 'GAS';
}

app.post('/upload', (req: Request, res: Response) => {
    const result = measurementSchema.safeParse(req.body);
  
    if (!result.success) { return res.status(400).json(generateValidationErrorResponse(result.error.errors)); }
  
    const measurement: Measurement = result.data;
  
    // TODO: Add Image Processment !

    res.status(200).json({ 
        image_url: "",
        measure_value: "",
        measure_uuid: ""
    });
});

const generateValidationErrorResponse = (errors: z.ZodIssue[]) => {
    const errorDetails: Record<string, string[]> = {};

    errors.forEach(error => {
        const path = error.path.join('.');
        const message = error.message;

        if (!errorDetails[path]) {
            errorDetails[path] = [];
        }

        errorDetails[path].push(message);
    });

    const formattedErrors = Object.entries(errorDetails).reduce((acc, [field, messages]) => {
        acc[`Field '${field}'`] = messages;
        return acc;
    }, {} as Record<string, string[]>);

    return {
        error_code: 'INVALID_DATA',
        error_description: formattedErrors,
    };
}