import express, { Request, Response } from 'express';
import { z } from 'zod';
import { parse, isValid } from 'date-fns';
import dotenv from 'dotenv';
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { writeFileSync, unlinkSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY || '';

const fileManager = new GoogleAIFileManager(apiKey);
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
});

app.use(express.json({limit: '10mb'}));

app.listen(port, () => {
  console.log(`[SERVER]: Server is running at PORT: ${port}`);
});

function base64ToFile(base64String: string, filePath: string) {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
}

function getMimeType(base64String: string): string {
    const mimeTypeMatch = base64String.match(/^data:(image\/[a-zA-Z]+);base64,/);
    return mimeTypeMatch ? mimeTypeMatch[1] : 'application/octet-stream';
}

function mimeTypeToFileExtension(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      default:
        return 'bin';
    }
}

async function uploadBase64Image(base64Image: string) {
    const mimeType = getMimeType(base64Image);

    const fileExtension = mimeTypeToFileExtension(mimeType);

    const fileName = `temp_${uuidv4()}`;

    const tempFilePath = `./${fileName}.${fileExtension}`;

    try {    
        base64ToFile(base64Image, tempFilePath);

        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
            mimeType: mimeType,
            displayName: `${fileName}.${fileExtension}`
        });
        
        const result = await model.generateContent([
            {
              fileData: {
                mimeType: uploadResponse.file.mimeType,
                fileUri: uploadResponse.file.uri
              }
            },
            { text: "Measure the value of this meter and return only the entire value, a integer value and nothing more." },
        ]);

        return { 
            image_url: uploadResponse.file.uri,
            measure_value: parseInt(result.response.text()),
            measure_uuid: uploadResponse.file.name
        };
    } catch (error) {
        console.error('Erro ao enviar imagem:', error);
    } finally {
        unlinkSync(tempFilePath);
    }
}

const isBase64Image = (image: string): boolean => {
    const base64ImageRegex = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

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

app.post('/upload', async (req: Request, res: Response) => {
    const result = measurementSchema.safeParse(req.body);
  
    if (!result.success) { return res.status(400).json(generateValidationErrorResponse(result.error.errors)); }
  
    const measurement: Measurement = result.data;

    try {
        const uploadResult = await uploadBase64Image(measurement.image);
        
        res.status(200).json(uploadResult);
    } catch (error) {
        console.error('Erro ao fazer upload da imagem:', error);

        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.patch('/confirm', async (req: Request, res: Response) => {

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