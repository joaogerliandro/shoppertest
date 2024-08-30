import express, { Request, Response } from 'express';
import { z } from 'zod';
import { parse, isValid } from 'date-fns';
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

const isBase64Image = (image: string): boolean => {
    const base64ImageRegex = /^data:image\/(png|jpg|jpeg|gif|bmp|webp);base64,/;
    return base64ImageRegex.test(image);
};

const isDateTimeValid = (date_time: string): boolean => {
    const formats = [
        "yyyy-MM-dd'T'HH:mm:ss.SSSxxx", 
        'dd/MM/yyyy', 
        'MM/dd/yyyy', 
        "yyyy/MM/dd", 
        'dd-MM-yyyy', 
        'MM-dd-yyyy', 
        'yyyy-MM-dd', 
        'yyyy.MM.dd', 
        'dd MMM yyyy', 
        'yyyy/MM/dd HH:mm:ss', 
        'MM/dd/yyyy HH:mm:ss', 
        'yyyy-MM-ddTHH:mm',
    ];
    
    return formats.some(format => {
        const parsedDate = parse(date_time, format, new Date());
        return isValid(parsedDate);
    });
};

const measurementSchema = z.object({
    image: z.string()
    .min(1, {
        message: "Image Base64 can not be empty !"
    })
    .refine(val => isBase64Image(val), {
        message: "Invalid Base64 image format"
    }),
    customer_code: z.string().min(1, {
        message: "Customer Code can not be empty !",
    }),
    measure_datetime: z.string()
    .min(1, {
        message: "Datetime can not be empty !",
    })
    .refine((val) => isDateTimeValid(val), {
        message: "Invalid datetime format",
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