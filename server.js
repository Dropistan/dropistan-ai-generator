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

if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
  console.error('Cloudflare Account ID or API Token missing.');
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

    methods: ['GET', 'POST', 'OPTIONS'],

    allowedHeaders: ['Content-Type']
  })
);

const CLOUDFLARE_URL =
  `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`;


/* =========================================
   HEALTH CHECK
========================================= */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'Dropistan AI Product Generator',
    provider: 'Cloudflare Workers AI',
    model: MODEL,
    version: '4.0 Premium'
  });
});


/* =========================================
   HELPERS
========================================= */

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


function stripCodeFences(text) {
  if (!text) return '';

  return String(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}


function extractObjectFromText(text) {
  if (!text) return null;

  let cleaned = stripCodeFences(text);

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

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
      'Could not parse AI JSON.'
    );

    console.error(
      'RAW AI TEXT:',
      text
    );

    return null;
  }
}


function extractProductObject(raw) {

  if (!raw) return null;

  if (
    raw?.result?.response &&
    typeof raw.result.response === 'object' &&
    !Array.isArray(raw.result.response)
  ) {
    return raw.result.response;
  }

  if (
    typeof raw?.result?.response === 'string'
  ) {
    const parsed =
      extractObjectFromText(
        raw.result.response
      );

    if (parsed) return parsed;
  }

  if (
    raw?.result &&
    typeof raw.result === 'object'
  ) {
    const direct = raw.result;

    if (
      direct.title ||
      direct.detected_product ||
      direct.full_description
    ) {
      return direct;
    }
  }

  return null;
}


/* =========================================
   NORMALIZE RESULT
========================================= */

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

    key_features:
      normalizeArray(
        result?.key_features
      ),

    benefits:
      normalizeArray(
        result?.benefits
      ),

    ideal_for:
      normalizeArray(
        result?.ideal_for
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


/* =========================================
   AI PRODUCT GENERATOR
========================================= */

app.post(
  '/api/generate-product-content',
  async (req, res) => {

    try {

      const {
        imageDataUrl,
        notes = '',
        language = 'English'
      } = req.body || {};


      /* IMAGE VALIDATION */

      if (
        !imageDataUrl ||
        typeof imageDataUrl !== 'string' ||
        !imageDataUrl.startsWith('data:image/')
      ) {
        return res.status(400).json({
          error:
            'Please upload a valid product image.'
        });
      }


      if (imageDataUrl.length > 15000000) {
        return res.status(413).json({
          error:
            'Image is too large.'
        });
      }


      /* =================================
         PREMIUM SHOPIFY PROMPT
      ================================= */

      const prompt = `

You are a professional e-commerce product researcher,
Shopify product listing writer and advanced SEO specialist.

Carefully ANALYSE the uploaded PRODUCT IMAGE.

Read all clearly visible:

- Product name
- Brand name
- Packaging
- Model
- Quantity
- Offer information
- Size
- Capacity
- Visible features
- Price
- Product category
- Text printed on the product

Also use this additional information supplied by the user:

${notes || 'No additional information provided.'}

OUTPUT LANGUAGE:

${language}


============================================

YOUR JOB

Create a COMPLETE, PROFESSIONAL,
HIGH-CONVERTING and SEO-OPTIMIZED
Shopify product listing.

The content should NOT be short,
generic or basic.

Create useful detailed content suitable
for a professional online store.

============================================

VERY IMPORTANT ACCURACY RULES

Only state facts that can reasonably be
confirmed from the image or user information.

DO NOT invent:

- Brand names
- Model numbers
- Materials
- Sizes
- Ingredients
- Certifications
- Country of manufacture
- Warranty
- Medical claims
- Technical specifications

If the brand cannot be confidently identified:

vendor = "Generic"

If uncertain about a detail,
do not present it as fact.

============================================

PRODUCT TITLE

Generate ONE professional SEO-friendly title.

Target approximately 55-80 characters
when practical.

Include:

Product type
Brand if clearly confirmed
Important visible feature
Quantity / pack / offer if applicable

Avoid keyword stuffing.

============================================

SHORT DESCRIPTION

Write approximately 60-100 words.

Make it attractive and sales-focused.

Explain:

What the product is
Main selling points
Why customers may want it
Ideal shopping/use context

Do not make unsupported claims.

============================================

FULL DESCRIPTION

Write a detailed professional Shopify description.

Target approximately 350-600 words where
the product provides enough information.

Organize it naturally.

Cover:

Product overview

Main visible characteristics

Design and appearance

Practical customer value

Possible everyday uses

Who the product may suit

Offer / quantity information if visible

Shopping-focused closing paragraph

Do NOT repeat the same sentence.

Do NOT fill the description with meaningless text.

============================================

KEY FEATURES

Generate 8-12 useful key features.

Each feature should be short,
clear and customer friendly.

Do not invent specifications.

============================================

BENEFITS

Generate 6-10 customer-oriented benefits.

Benefits must be reasonable based on
the actual product category.

Do not make medical or unsupported claims.

============================================

IDEAL FOR

Generate 5-8 suitable use cases,
customer types or occasions.

============================================

SEO TITLE

Create a strong Google SEO title.

Target approximately 50-60 characters.

Use the main product keyword naturally.

============================================

META DESCRIPTION

Create approximately 140-160 characters.

Make it attractive for Google search.

Include the main keyword naturally.

============================================

SEO KEYWORDS

THIS FIELD MUST NOT BE EMPTY.

Generate AT LEAST 20 useful SEO keywords.

Prefer 20-30 keywords.

Include a natural mixture of:

Main product keyword
Product category keywords
Long-tail keywords
Buyer-intent keywords
Feature-related keywords
Online shopping keywords

Do not duplicate keywords.

============================================

SHOPIFY TAGS

THIS FIELD MUST NOT BE EMPTY.

Generate AT LEAST 20 Shopify tags.

Prefer 20-30 tags.

Tags should help with:

Shopify search
Product filtering
Collections
Product category
Customer shopping intent

Do not duplicate tags.

============================================

ALT TEXT

Create descriptive SEO-friendly
image ALT text.

Describe the actual product image.

============================================

HANDLE

Create a clean Shopify URL handle.

Rules:

lowercase only
hyphens between words
no unnecessary symbols
no spaces

============================================

REQUIRED OUTPUT

Return ONLY ONE VALID JSON OBJECT.

NO markdown.

NO triple backticks.

NO introduction.

NO explanation outside JSON.

Use EXACTLY these keys:

{
  "detected_product": "",
  "title": "",
  "short_description": "",
  "full_description": "",
  "vendor": "",
  "product_type": "",
  "key_features": [],
  "benefits": [],
  "ideal_for": [],
  "seo_title": "",
  "meta_description": "",
  "keywords": [],
  "tags": [],
  "alt_text": "",
  "handle_suggestion": ""
}

IMPORTANT:

keywords MUST contain at least 20 items.

tags MUST contain at least 20 items.

key_features should contain 8-12 items.

benefits should contain 6-10 items.

ideal_for should contain 5-8 items.

Return valid JSON only.

`;


      /* =================================
         CLOUDFLARE REQUEST
      ================================= */

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
                      'You are a professional Shopify e-commerce and SEO expert. Analyse the product image carefully and return detailed accurate product information as valid JSON only.'
                  },

                  {
                    role: 'user',
                    content: prompt
                  }

                ],

                image:
                  imageDataUrl,

                max_tokens:
                  3500,

                temperature:
                  0.2,

                top_p:
                  0.9,

                stream:
                  false
              })
          }
        );


      /* =================================
         READ RESPONSE
      ================================= */

      let raw;

      try {

        raw =
          await aiResponse.json();

      } catch (error) {

        console.error(
          'Cloudflare response was not JSON.'
        );

        return res.status(502).json({
          error:
            'Cloudflare returned an unreadable response.'
        });
      }


      console.log(
        'Cloudflare HTTP Status:',
        aiResponse.status
      );


      if (raw?.result?.usage) {

        console.log(
          'Cloudflare Usage:',
          raw.result.usage
        );
      }


      /* =================================
         CLOUDFLARE ERROR
      ================================= */

      if (
        !aiResponse.ok ||
        raw?.success === false
      ) {

        console.error(
          'Cloudflare API Error:',
          JSON.stringify(raw, null, 2)
        );


        if (aiResponse.status === 429) {

          return res.status(429).json({

            error:
              'Cloudflare AI daily allowance has been reached. Please try again after the daily reset.'
          });
        }


        const message =
          raw?.errors?.[0]?.message ||
          'Cloudflare AI generation failed.';


        return res
          .status(aiResponse.status || 500)
          .json({
            error: message
          });
      }


      /* =================================
         PARSE PRODUCT DATA
      ================================= */

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
          'Product JSON could not be extracted.'
        );

        return res.status(502).json({

          error:
            'AI response could not be processed. Please try again.'
        });
      }


      const result =
        normalizeResult(parsed);


      /* =================================
         BASIC VALIDATION
      ================================= */

      if (
        !result.title &&
        !result.detected_product
      ) {

        return res.status(502).json({

          error:
            'AI could not clearly identify this product.'
        });
      }


      /* =================================
         KEYWORDS FALLBACK
      ================================= */

      if (result.keywords.length === 0) {

        const base =
          result.title ||
          result.detected_product ||
          result.product_type;

        result.keywords = [

          base,
          `${base} online`,
          `buy ${base}`,
          `${base} UAE`,
          `${base} Dubai`,
          `${base} online UAE`,
          `best ${base}`,
          `${base} price`,
          `${base} offer`,
          `${base} deals`,
          `${base} shopping`,
          `${base} online shopping`,
          `${base} delivery`,
          `${base} ecommerce`,
          `${base} shop`,
          `${base} product`,
          `${base} sale`,
          `${base} deal`,
          `${base} Dropistan`,
          `buy ${base} online UAE`

        ].filter(Boolean);
      }


      /* =================================
         TAGS FALLBACK
      ================================= */

      if (result.tags.length === 0) {

        const base =
          result.product_type ||
          result.detected_product ||
          'Product';

        result.tags = [

          base,
          'Online Shopping',
          'UAE Shopping',
          'Dubai Shopping',
          'Shop Online',
          'Best Seller',
          'Popular Product',
          'Special Offer',
          'Online Deal',
          'Shopify Product',
          'Dropistan',
          'UAE Deals',
          'Dubai Deals',
          'Online Store',
          'Ecommerce',
          'Shopping Deal',
          'Product Offer',
          'UAE Online Store',
          'Buy Online',
          'Online Product'

        ];
      }


      /* =================================
         SUCCESS
      ================================= */

      console.log(
        'Generated:',
        result.title
      );

      console.log(
        'Keywords:',
        result.keywords.length
      );

      console.log(
        'Tags:',
        result.tags.length
      );


      return res.json({

        ok: true,

        provider:
          'Cloudflare Workers AI',

        model:
          MODEL,

        version:
          'Dropistan Premium Product Generator v4',

        result
      });


    } catch (error) {

      console.error(
        'SERVER ERROR:',
        error
      );


      return res.status(500).json({

        error:
          'Something went wrong while generating product details.'
      });
    }
  }
);


/* =========================================
   START SERVER
========================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Dropistan AI Generator running on port ${PORT}`
    );

    console.log(
      `Using Cloudflare model: ${MODEL}`
    );

    console.log(
      'PREMIUM PRODUCT GENERATOR V4 LOADED'
    );

  }
);
