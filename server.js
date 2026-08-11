import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();

const PORT = Number(process.env.PORT || 3000);

const CLOUDFLARE_ACCOUNT_ID =
  process.env.CLOUDFLARE_ACCOUNT_ID;

const CLOUDFLARE_API_TOKEN =
  process.env.CLOUDFLARE_API_TOKEN;

const MODEL =
  '@cf/meta/llama-3.2-11b-vision-instruct';

if (
  !CLOUDFLARE_ACCOUNT_ID ||
  !CLOUDFLARE_API_TOKEN
) {
  console.error(
    'Cloudflare Account ID or API Token missing.'
  );
  process.exit(1);
}

const allowedOriginsRaw =
  process.env.ALLOWED_ORIGINS || '*';

const allowedOrigins =
  allowedOriginsRaw === '*'
    ? '*'
    : allowedOriginsRaw
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  express.json({
    limit: '16mb'
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins === '*' ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error('Origin not allowed')
      );
    },

    methods: [
      'GET',
      'POST',
      'OPTIONS'
    ],

    allowedHeaders: [
      'Content-Type'
    ]
  })
);

const CLOUDFLARE_URL =
  `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`;


/* ===========================
   HEALTH CHECK
=========================== */

app.get(
  '/health',
  function(req, res) {
    res.json({
      ok: true,
      service:
        'Dropistan Cloudflare AI Product Generator',
      provider:
        'Cloudflare Workers AI',
      model: MODEL
    });
  }
);


/* ===========================
   LICENSE ACCEPT
=========================== */

app.get(
  '/api/agree-license',
  async function(req, res) {
    try {
      const response =
        await fetch(
          CLOUDFLARE_URL,
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${CLOUDFLARE_API_TOKEN}`,

              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                prompt: 'agree'
              })
          }
        );

      const data =
        await response.json();

      return res
        .status(response.status)
        .json({
          ok: response.ok,
          result: data
        });

    } catch (error) {
      console.error(
        'License error:',
        error
      );

      return res
        .status(500)
        .json({
          error:
            'Could not accept model license.'
        });
    }
  }
);


/* ===========================
   HELPERS
=========================== */

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map(v => v.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }

  return [];
}


function normalizeResult(result) {
  return {
    detected_product:
      String(
        result?.detected_product || ''
      ),

    title:
      String(
        result?.title || ''
      ),

    short_description:
      String(
        result?.short_description || ''
      ),

    full_description:
      String(
        result?.full_description || ''
      ),

    vendor:
      String(
        result?.vendor || 'Generic'
      ),

    product_type:
      String(
        result?.product_type || ''
      ),

    seo_title:
      String(
        result?.seo_title || ''
      ),

    meta_description:
      String(
        result?.meta_description || ''
      ),

    keywords:
      normalizeArray(
        result?.keywords
      ),

    tags:
      normalizeArray(
        result?.tags
      ),

    key_features:
      normalizeArray(
        result?.key_features
      ),

    alt_text:
      String(
        result?.alt_text || ''
      ),

    handle_suggestion:
      String(
        result?.handle_suggestion || ''
      )
  };
}


function stripCodeFences(text) {
  return text
    .replace(
      /^```json\s*/i,
      ''
    )
    .replace(
      /^```\s*/i,
      ''
    )
    .replace(
      /\s*```$/i,
      ''
    )
    .trim();
}


function extractObjectFromText(text) {
  if (
    typeof text !== 'string' ||
    !text.trim()
  ) {
    return null;
  }

  let cleaned =
    stripCodeFences(
      text.trim()
    );

  const firstBrace =
    cleaned.indexOf('{');

  const lastBrace =
    cleaned.lastIndexOf('}');

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned =
      cleaned.slice(
        firstBrace,
        lastBrace + 1
      );
  }

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error(
      'JSON parse failed.'
    );

    console.error(
      'RAW TEXT:',
      text
    );

    return null;
  }
}


function extractProductObject(raw) {
  if (!raw) {
    return null;
  }

  /*
   * CASE 1:
   * Cloudflare returns:
   * result.response = object
   */
  if (
    raw?.result?.response &&
    typeof raw.result.response ===
      'object' &&
    !Array.isArray(
      raw.result.response
    )
  ) {
    return raw.result.response;
  }

  /*
   * CASE 2:
   * Cloudflare returns:
   * result.response = string
   */
  if (
    typeof raw?.result?.response ===
      'string'
  ) {
    const parsed =
      extractObjectFromText(
        raw.result.response
      );

    if (parsed) {
      return parsed;
    }
  }

  /*
   * CASE 3:
   * Product fields are directly
   * inside result
   */
  if (
    raw?.result &&
    typeof raw.result === 'object'
  ) {
    const direct =
      raw.result;

    if (
      direct.title ||
      direct.detected_product ||
      direct.full_description ||
      direct.product_type
    ) {
      return direct;
    }
  }

  /*
   * CASE 4:
   * Entire API response itself
   * contains product fields
   */
  if (
    typeof raw === 'object' &&
    (
      raw.title ||
      raw.detected_product ||
      raw.full_description
    )
  ) {
    return raw;
  }

  return null;
}


/* ===========================
   PRODUCT GENERATOR
=========================== */

app.post(
  '/api/generate-product-content',
  async function(req, res) {
    try {
      const {
        imageDataUrl,
        notes = '',
        language = 'English'
      } = req.body || {};

      if (
        !imageDataUrl ||
        typeof imageDataUrl !==
          'string' ||
        !imageDataUrl.startsWith(
          'data:image/'
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Please upload a valid product image.'
          });
      }

      if (
        imageDataUrl.length >
        15000000
      ) {
        return res
          .status(413)
          .json({
            error:
              'Image is too large.'
          });
      }


      const prompt = `
You are an expert Shopify product
listing writer and SEO specialist.

Carefully inspect the uploaded
product image.

Create complete Shopify-ready
product information.

Language:
${language}

Extra information supplied
by user:
${notes || 'None'}

IMPORTANT:

Return ONLY one valid JSON object.

Do not use markdown.

Do not place JSON inside
triple backticks.

Do not add explanation before
or after the JSON.

Use exactly these field names:

{
  "detected_product": "",
  "title": "",
  "short_description": "",
  "full_description": "",
  "vendor": "",
  "product_type": "",
  "seo_title": "",
  "meta_description": "",
  "keywords": [],
  "tags": [],
  "key_features": [],
  "alt_text": "",
  "handle_suggestion": ""
}

RULES:

Identify the real product shown
in the image.

Read visible text and packaging
carefully.

Use a brand only if clearly visible.

If no brand can be confirmed,
use "Generic" for vendor.

Never invent:
brand,
model number,
size,
material,
country of origin,
ingredients,
certification,
guarantee,
medical claim,
technical specification.

Product Title:
Professional and SEO friendly.

Short Description:
1 to 2 sentences.

Full Description:
Professional Shopify-ready
product copy.

SEO Title:
Prefer about 50 to 60 characters.

Meta Description:
Prefer about 140 to 160 characters.

Keywords:
Generate 12 to 20.

Tags:
Generate 12 to 20.

Key Features:
Generate 4 to 7.

ALT Text:
Clear product image description.

Handle:
Lowercase words separated
by hyphens.

Return JSON only.
`;


      const aiResponse =
        await fetch(
          CLOUDFLARE_URL,
          {
            method: 'POST',

            headers: {
              Authorization:
                `Bearer ${CLOUDFLARE_API_TOKEN}`,

              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                messages: [
                  {
                    role: 'system',

                    content:
                      'Analyse product images and return accurate Shopify product data. Return JSON only.'
                  },

                  {
                    role: 'user',
                    content: prompt
                  }
                ],

                image:
                  imageDataUrl,

                max_tokens:
                  1800,

                temperature:
                  0,

                top_p:
                  0.8,

                stream:
                  false
              })
          }
        );


      let raw;

      try {
        raw =
          await aiResponse.json();
      } catch (error) {
        console.error(
          'Cloudflare HTTP response was not JSON.'
        );

        return res
          .status(502)
          .json({
            error:
              'Cloudflare returned an unreadable response.'
          });
      }


      console.log(
        'Cloudflare status:',
        aiResponse.status
      );


      if (
        raw?.result?.usage
      ) {
        console.log(
          'Usage:',
          raw.result.usage
        );
      }


      if (
        !aiResponse.ok ||
        raw?.success === false
      ) {
        console.error(
          'Cloudflare error:',
          JSON.stringify(
            raw,
            null,
            2
          )
        );

        const errorCode =
          raw?.errors?.[0]?.code;

        const errorMessage =
          raw?.errors?.[0]
            ?.message ||
          'Cloudflare AI generation failed.';


        if (
          errorCode === 5016
        ) {
          return res
            .status(403)
            .json({
              error:
                'Cloudflare model license is not accepted.'
            });
        }


        if (
          aiResponse.status === 429
        ) {
          return res
            .status(429)
            .json({
              error:
                'Daily Cloudflare AI free allowance has been reached.'
            });
        }


        return res
          .status(
            aiResponse.status || 500
          )
          .json({
            error:
              errorMessage
          });
      }


      /*
       * MOST IMPORTANT FIX
       */

      console.log(
        'FULL CLOUDFLARE RESULT:',
        JSON.stringify(
          raw?.result,
          null,
          2
        )
      );


      const parsed =
        extractProductObject(raw);


      if (!parsed) {
        console.error(
          'Could not locate product object.'
        );

        return res
          .status(502)
          .json({
            error:
              'AI response could not be processed. Please try again.'
          });
      }


      const result =
        normalizeResult(parsed);


      if (
        !result.title &&
        !result.detected_product
      ) {
        console.error(
          'Parsed result:',
          result
        );

        return res
          .status(502)
          .json({
            error:
              'AI could not identify this product clearly.'
          });
      }


      return res.json({
        ok: true,

        provider:
          'Cloudflare Workers AI',

        model:
          MODEL,

        result
      });

    } catch (error) {
      console.error(
        'SERVER ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          error:
            'Something went wrong while generating product details.'
        });
    }
  }
);


/* ===========================
   START SERVER
=========================== */

app.listen(
  PORT,
  function() {
    console.log(
      `Cloudflare AI Generator running on port ${PORT}`
    );

    console.log(
      `Using model: ${MODEL}`
    );

    console.log(
      'Product response parser v3 loaded.'
    );
  }
);
