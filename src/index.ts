import express, { Request, Response } from 'express';
import { z } from 'zod';
import { format, parse, isValid } from 'date-fns';
import dotenv from 'dotenv';
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { writeFileSync, unlinkSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import pool from './db';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY || '';

const fileManager = new GoogleAIFileManager(apiKey);
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
});

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

async function uploadBase64Image(measurement: Measurement, date: Date) {
    const mimeType = getMimeType(measurement.image);

    const fileExtension = mimeTypeToFileExtension(mimeType);

    const fileName = `temp_${uuidv4()}`;

    const tempFilePath = `./${fileName}.${fileExtension}`;

    try {    
        base64ToFile(measurement.image, tempFilePath);

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

        const formattedDate = format(date, 'yyyy-MM-dd');

        const queryInsert = 'INSERT INTO public."Measurement" (uuid, value, datetime, type, confirmed, customer_code, url) VALUES ($1, $2, $3, $4, $5, $6, $7)';

        pool.query(queryInsert, [uploadResponse.file.name, parseInt(result.response.text()), 
            formattedDate, measurement.measure_type, 
            false, measurement.customer_code, uploadResponse.file.uri ]
        );

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
    return formats.some(format => {
        const parsedDate = parse(date_time, format, new Date());
        return isValid(parsedDate);
    });
};

function parseDateFromFormats(dateString: string): Date | null {
    for (const format of formats) {
        const parsedDate = parse(dateString, format, new Date());
        if (isValid(parsedDate)) {
            return parsedDate;
        }
    }

    return null;
}

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

const confirmationSchema = z.object({
    measure_uuid: z.string()
    .min(1, {
        message: "UUID can not be empty !"
    }),
    confirmed_value: z.number()
});

const measureTypeSchema = z.enum(['WATER', 'GAS']);

interface Measurement {
    image: string;
    customer_code: string;
    measure_datetime: string;
    measure_type: 'WATER' | 'GAS';
}

interface Confirmation {
    measure_uuid: string;
    confirmed_value: number;
}

app.post('/upload', async (req: Request, res: Response) => {
    const result = measurementSchema.safeParse(req.body);
  
    if (!result.success) { return res.status(400).json(generateValidationErrorResponse(result.error.errors)); }
  
    const measurement: Measurement = result.data;

    try {
        const date = parseDateFromFormats(measurement.measure_datetime);

        if(date != null)
        {
            const month = date.getUTCMonth() + 1;
            const year = date.getUTCFullYear();
            const type = measurement.measure_type;

            const queryCount = `SELECT COUNT(*) FROM public."Measurement" WHERE EXTRACT(MONTH FROM datetime) = $1 AND EXTRACT(YEAR FROM datetime) = $2 AND type = $3;`;    

            const { rows } = await pool.query(queryCount, [month, year, type]);
            const orderCount = parseInt(rows[0].count, 10);

            if (orderCount > 0) {
                return res.status(409).json({
                    error_code: "DOUBLE_REPORT",
                    error_description: `There is already a reading for the type ${measurement.measure_type} for the month entered.`
                });
            }

            const uploadResult = await uploadBase64Image(measurement, date);

            res.status(200).json(uploadResult);
        }
        else
        {
            return res.status(400).json({
                error_code: "INVALID_DATA",
                error_description: 'Invalid datetime format.'
            });
        }
    } catch (error) {
        return res.status(500).json({
            error_code: "INTERNAL_ERROR",
            error_description: 'Server Internal Error.'
        });
    }
});

app.patch('/confirm', async (req: Request, res: Response) => {
    const result = confirmationSchema.safeParse(req.body);

    if (!result.success) { return res.status(400).json(generateValidationErrorResponse(result.error.errors)); }

    const confirmation: Confirmation = result.data;

    try{
        const queryCount = `SELECT COUNT(*) FROM public."Measurement" WHERE uuid = $1;`;

        const { rows } = await pool.query(queryCount, [confirmation.measure_uuid]);
        const orderCount = parseInt(rows[0].count, 10);

        if (orderCount < 1) {
            return res.status(404).json({
                error_code: "MEASURE_NOT_FOUND",
                error_description: `Measure with UUID: ${confirmation.measure_uuid} not found.`
            });
        }

        const result = await pool.query(`SELECT confirmed FROM public."Measurement" WHERE uuid = $1;`, [confirmation.measure_uuid]);

        if(result.rows[0].confirmed)
        {
            return res.status(409).json({
                error_code: "CONFIRMATION_DUPLICATE",
                error_description: `Measure with UUID: ${confirmation.measure_uuid} already confirmed.`
            });
        }

        pool.query(`UPDATE public."Measurement" SET confirmed = $1, value = $2 WHERE uuid = $3;`, [true, confirmation.confirmed_value, confirmation.measure_uuid]);

        res.status(200).json({
            success: true
        });
    } catch (error) {
        return res.status(500).json({
            error_code: "INTERNAL_ERROR",
            error_description: 'Server Internal Error.'
        });
    }
});

app.get('/:customer_code/list', async (req: Request, res: Response) => {
    const { customer_code } = req.params;
    const { measure_type } = req.query;

    try{
        let measureType: string | undefined = undefined;

        if (measure_type !== undefined) {
            if (typeof measure_type === 'string') {
                const normalizedMeasureType = measure_type.toUpperCase();
                
                const result = measureTypeSchema.safeParse(normalizedMeasureType);

                if (result.success) {
                    measureType = result.data;
                } else {
                    return res.status(400).json({
                        error_code: "INVALID_TYPE",
                        error_description: 'Invalid value to parameter measure_type . Expected values WATER | GAS.'
                    });
                }
            } else {
                return res.status(400).json({
                    error_code: "INVALID_TYPE",
                    error_description: 'Invalid format to parameter measure_type. Expected format "string"'
                });
            }
        }

        const query = `SELECT * FROM public."Measurement" WHERE customer_code = $1${measureType ? ' AND type = $2' : ''};`;
        
        const params = measureType ? [customer_code, measureType] : [customer_code];

        const result = await pool.query(query, params);

        if (result.rows.length > 0) {
            res.status(200).json({
                customer_code: customer_code,
                measures: result.rows.map(row => ({
                    measure_uuid: row.uuid,
                    measure_datetime: row.datetime,
                    measure_type: row.type,
                    has_confirmed: row.confirmed,
                    image_url: row.url
                }))
            });
        } else {
            return res.status(404).json({
                error_code: "INVALID_TYPE",
                error_description: 'No meansure readings found to this customer.'
            });
        }
    } catch (error) {
        return res.status(500).json({
            error_code: "INTERNAL_ERROR",
            error_description: 'Server Internal Error.'
        });
    }
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