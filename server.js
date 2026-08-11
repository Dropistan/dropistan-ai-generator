import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();

const PORT = Number(
  process.env.PORT || 3000
);

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
        return callback(
          null,
          true
        );
      }

      return callback(
        new Error(
          'Origin not allowed'
        )
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


/* =====================================
   HEALTH CHECK
===================================== */

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


/* =====================================
   PRODUCT JSON SCHEMA
===================================== */

const productSchema = {

  type: 'object',

  additionalProperties: false,

  properties: {

    detected_product: {
      type: 'string'
    },

    title: {
      type: 'string'
    },

    short_description: {
      type: 'string'
    },

    full_description: {
      type: 'string'
    },

    vendor: {
      type: 'string'
    },

    product_type: {
      type: 'string'
    },

    seo_title: {
      type: 'string'
    },

    meta_description: {
      type: 'string'
    },

    keywords: {
      type: 'array',
      items: {
        type: 'string'
      }
    },

    tags: {
      type: 'array',
      items: {
        type: 'string'
      }
    },

    key_features: {
      type: 'array',
      items: {
        type: 'string'
      }
    },

    alt_text: {
      type: 'string'
    },

    handle_suggestion: {
      type: 'string'
    }

  },

  required: [
    'detected_product',
    'title',
    'short_description',
    'full_description',
    'vendor',
    'product_type',
    'seo_title',
    'meta_description',
    'keywords',
    'tags',
    'key_features',
    'alt_text',
    'handle_suggestion'
  ]

};


/* =====================================
   NORMALIZE ARRAYS
===================================== */

function normalizeArray(value) {

  if (Array.isArray(value)) {

    return value
      .map(String)
      .map(v => v.trim())
      .filter(Boolean);

  }

  if (
    typeof value === 'string'
  ) {

    return value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

  }

  return [];
}


/* =====================================
   NORMALIZE FINAL RESULT
===================================== */

function normalizeResult(result) {

  if (
    !result ||
    typeof result !== 'object'
  ) {
    result = {};
  }

  return {

    detected_product:
      String(
        result.detected_product || ''
      ),

    title:
      String(
        result.title || ''
      ),

    short_description:
      String(
        result.short_description || ''
      ),

    full_description:
      String(
        result.full_description || ''
      ),

    vendor:
      String(
        result.vendor || 'Generic'
      ),

    product_type:
      String(
        result.product_type || ''
      ),

    seo_title:
      String(
        result.seo_title || ''
      ),

    meta_description:
      String(
        result.meta_description || ''
      ),

    keywords:
      normalizeArray(
        result.keywords
      ),

    tags:
      normalizeArray(
        result.tags
      ),

    key_features:
      normalizeArray(
        result.key_features
      ),

    alt_text:
      String(
        result.alt_text || ''
      ),

    handle_suggestion:
      String(
        result.handle_suggestion || ''
      )

  };

}


/* =====================================
   REMOVE MARKDOWN IF AI RETURNS TEXT
===================================== */

function cleanJsonText(text) {

  if (
    typeof text !== 'string'
  ) {
    return '';
  }

  let cleaned =
    text.trim();

  cleaned =
    cleaned
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

  const firstBrace =
    cleaned.indexOf('{');

  const lastBrace =
    cleaned.lastIndexOf('}');

  if (
    firstBrace !== -1 &&
    lastBrace !== -1
  ) {

    cleaned =
      cleaned.slice(
        firstBrace,
        lastBrace + 1
      );

  }

  return cleaned;

}


/* =====================================
   EXTRACT CLOUDFLARE RESPONSE
===================================== */

function extractProductObject(raw) {

  const response =
    raw?.result?.response;

  /*
    BEST CASE:
    JSON Mode returns an object
  */

  if (
    response &&
    typeof response === 'object' &&
    !Array.isArray(response)
  ) {

    return response;

  }


  /*
    FALLBACK:
    Model returns JSON string
  */

  if (
    typeof response === 'string'
  ) {

    const cleaned =
      cleanJsonText(response);

    if (cleaned) {

      try {

        return JSON.parse(
          cleaned
        );

      } catch (error) {

        console.error(
          'Could not parse response string.'
        );

        console.error(
          response
        );

      }

    }

  }


  /*
    SOME CLOUDFLARE RESPONSES
    MAY RETURN RESULT DIRECTLY
  */

  if (
    raw?.result &&
    typeof raw.result === 'object' &&
    !Array.isArray(raw.result)
  ) {

    const possibleResult =
      raw.result;

    if (
      possibleResult.title ||
      possibleResult.detected_product
    ) {

      return possibleResult;

    }

  }

  return null;

}


/* =====================================
   ACCEPT META LICENSE
===================================== */

async function agreeToMetaLicense() {

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

  console.log(
    'Meta license response status:',
    response.status
  );

  return {
    status:
      response.status,

    data
  };

}


/* =====================================
   LICENSE URL
===================================== */

app.get(
  '/api/agree-license',
  async function(req, res) {

    try {

      const license =
        await agreeToMetaLicense();

      return res
        .status(
          license.status
        )
        .json({

          ok:
            license.status >= 200 &&
            license.status < 300,

          result:
            license.data

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


/* =====================================
   GENERATE PRODUCT DETAILS
===================================== */

app.post(
  '/api/generate-product-content',
  async function(req, res) {

    try {

      const {
        imageDataUrl,
        notes = '',
        language = 'English'
      } = req.body || {};


      /* --------------------------
         VALIDATE IMAGE
      -------------------------- */

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


      /* --------------------------
         PROMPT
      -------------------------- */

      const prompt = `
You are a professional Shopify
e-commerce product listing expert,
SEO specialist and copywriter.

Carefully inspect the uploaded
product image.

Generate complete Shopify-ready
product listing information.

OUTPUT LANGUAGE:
${language}

USER PROVIDED INFORMATION:
${notes || 'No additional information provided.'}

IMPORTANT ACCURACY RULES:

1. Identify the actual product
shown in the image.

2. Read visible packaging text
carefully.

3. Use a brand name only when
it is clearly visible in the image
or supplied by the user.

4. If the brand cannot be
confirmed, set vendor to "Generic".

5. Never invent:
- brand names
- model numbers
- country of manufacture
- size
- material
- ingredients
- certifications
- guarantees
- medical claims
- technical specifications

unless clearly visible in the image
or explicitly supplied by the user.

6. User notes are useful context,
but do not turn unsupported claims
into facts.

CONTENT REQUIREMENTS:

Product title:
Professional, attractive and
SEO-friendly.

Short description:
Approximately 1 to 2 sentences.

Full description:
Useful Shopify product description.
Professional and easy to read.

SEO title:
Prefer approximately 50-60
characters where practical.

Meta description:
Prefer approximately 140-160
characters where practical.

Keywords:
Generate 12 to 20 useful
search keywords.

Shopify tags:
Generate 12 to 20 relevant tags.

Key features:
Generate approximately 4 to 7
concise product features.

ALT text:
Describe the product image clearly.

URL handle:
Lowercase words separated
with hyphens.

Do not add information outside
the requested structured fields.
`;


      /* --------------------------
         CLOUDFLARE REQUEST
      -------------------------- */

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
                    role:
                      'system',

                    content:
                      'Analyse the product image and produce accurate structured Shopify product data.'
                  },

                  {
                    role:
                      'user',

                    content:
                      prompt
                  }

                ],

                image:
                  imageDataUrl,

                response_format: {

                  type:
                    'json_schema',

                  json_schema:
                    productSchema

                },

                max_tokens:
                  1600,

                temperature:
                  0.1,

                top_p:
                  0.9,

                stream:
                  false

              })

          }
        );


      /* --------------------------
         READ CLOUDFLARE RESPONSE
      -------------------------- */

      let raw;

      try {

        raw =
          await aiResponse.json();

      } catch (error) {

        console.error(
          'Cloudflare returned non-JSON HTTP response.'
        );

        return res
          .status(502)
          .json({

            error:
              'Cloudflare returned an unreadable response. Please try again.'

          });

      }


      /* --------------------------
         LOG USAGE
      -------------------------- */

      console.log(
        'Cloudflare HTTP status:',
        aiResponse.status
      );

      if (
        raw?.result?.usage
      ) {

        console.log(
          'AI usage:',
          raw.result.usage
        );

      }


      /* --------------------------
         HANDLE CLOUDFLARE ERRORS
      -------------------------- */

      if (
        !aiResponse.ok ||
        raw?.success === false
      ) {

        console.error(
          'Cloudflare AI error:',
          JSON.stringify(raw)
        );

        const errorCode =
          raw?.errors?.[0]?.code;

        const errorMessage =
          raw?.errors?.[0]?.message ||
          raw?.messages?.[0]?.message ||
          'Cloudflare AI generation failed.';


        if (
          errorCode === 5016
        ) {

          return res
            .status(403)
            .json({

              error:
                'Cloudflare model license is not accepted. Open /api/agree-license once.'

            });

        }


        if (
          aiResponse.status === 429
        ) {

          return res
            .status(429)
            .json({

              error:
                'Cloudflare free AI daily allowance has been reached. Please try again after the daily reset.'

            });

        }


        if (
          String(
            errorMessage
          )
            .toLowerCase()
            .includes(
              'json mode'
            )
        ) {

          return res
            .status(502)
            .json({

              error:
                'AI could not produce the structured product information. Please press Generate again.'

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


      /* --------------------------
         EXTRACT STRUCTURED PRODUCT
      -------------------------- */

      const parsed =
        extractProductObject(raw);


      if (!parsed) {

        console.error(
          'Unable to extract product object.'
        );

        console.error(
          JSON.stringify(
            raw,
            null,
            2
          )
        );

        return res
          .status(502)
          .json({

            error:
              'AI response could not be processed. Please try again.'

          });

      }


      /* --------------------------
         NORMALIZE RESULT
      -------------------------- */

      const result =
        normalizeResult(parsed);


      /* --------------------------
         BASIC VALIDATION
      -------------------------- */

      if (
        !result.title &&
        !result.detected_product
      ) {

        console.error(
          'AI result missing essential product information:',
          result
        );

        return res
          .status(502)
          .json({

            error:
              'AI could not identify this product clearly. Please upload a clearer image.'

          });

      }


      /* --------------------------
         SUCCESS
      -------------------------- */

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
        'Generator server error:',
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


/* =====================================
   START SERVER
===================================== */

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
      'JSON structured output enabled.'
    );

  }
);
