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

app.get('/health', function(req, res) {
  res.json({
    ok: true,
    service:
      'Dropistan Cloudflare AI Product Generator',
    model: MODEL
  });
});

function cleanJsonText(text) {
  if (!text) return '';

  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
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
        result.detected_product || ''
      ),

    title:
      String(result.title || ''),

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

async function agreeToMetaLicense() {
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

          body: JSON.stringify({
            prompt: 'agree'
          })
        }
      );

    const data =
      await response.json();

    console.log(
      'Meta license response:',
      response.status
    );

    return data;

  } catch (error) {
    console.error(
      'License agreement error:',
      error
    );
  }
}

app.get(
  '/api/agree-license',
  async function(req, res) {
    try {
      const data =
        await agreeToMetaLicense();

      return res.json({
        ok: true,
        result: data
      });

    } catch (error) {
      return res
        .status(500)
        .json({
          error:
            'Could not accept model license.'
        });
    }
  }
);

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
You are a professional Shopify
product listing expert and SEO
copywriter.

Carefully analyse the product
shown in the uploaded image.

Generate complete Shopify-ready
product content.

Language:
${language}

Additional user information:
${notes || 'None'}

Return ONLY valid JSON.
Do not use markdown.
Do not add text before or after
the JSON.

Use exactly this JSON structure:

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

Requirements:

- Identify the actual product
  visible in the image.
- Product title should be
  professional and SEO friendly.
- Short description:
  approximately 1-2 sentences.
- Full description:
  professional Shopify listing
  copy with useful product
  information and benefits.
- SEO title:
  ideally under 60 characters.
- Meta description:
  ideally around 140-160
  characters.
- Generate 12-20 relevant
  SEO keywords.
- Generate 12-20 Shopify tags.
- Generate 4-7 key features.
- Shopify tags and keywords
  must be short phrases.
- Create useful image ALT text.
- URL handle must be lowercase,
  SEO friendly and use hyphens.
- If no brand is clearly visible,
  use "Generic" as vendor.
- Never invent model numbers,
  brand names, sizes, materials,
  certifications, guarantees,
  medical claims or technical
  specifications that cannot
  reasonably be determined from
  the image or user notes.
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
                      'You create accurate Shopify product content from product images. Return valid JSON only.'
                  },

                  {
                    role: 'user',
                    content: prompt
                  }
                ],

                image:
                  imageDataUrl,

                max_tokens: 2200,

                temperature: 0.2,

                stream: false
              })
          }
        );

      const raw =
        await aiResponse.json();

      if (!aiResponse.ok) {
        console.error(
          'Cloudflare AI error:',
          JSON.stringify(raw)
        );

        const errorCode =
          raw?.errors?.[0]?.code;

        if (errorCode === 5016) {
          return res
            .status(403)
            .json({
              error:
                'Cloudflare model license has not been accepted yet. Open /api/agree-license once and try again.'
            });
        }

        if (aiResponse.status === 429) {
          return res
            .status(429)
            .json({
              error:
                'Cloudflare free AI daily allowance has been reached. Please try again after the daily reset.'
            });
        }

        return res
          .status(aiResponse.status)
          .json({
            error:
              raw?.errors?.[0]
                ?.message ||
              'Cloudflare AI generation failed.'
          });
      }

      const generatedText =
        raw?.result?.response ||
        raw?.result ||
        '';

      if (
        typeof generatedText !==
        'string' ||
        !generatedText.trim()
      ) {
        console.error(
          'Unexpected Cloudflare output:',
          raw
        );

        return res
          .status(502)
          .json({
            error:
              'AI returned an empty response.'
          });
      }

      const jsonText =
        cleanJsonText(
          generatedText
        );

      let parsed;

      try {
        parsed =
          JSON.parse(jsonText);
      } catch (error) {
        console.error(
          'JSON parse error:',
          generatedText
        );

        return res
          .status(502)
          .json({
            error:
              'AI generated an invalid response. Please try again.'
          });
      }

      const result =
        normalizeResult(parsed);

      return res.json({
        ok: true,
        provider:
          'Cloudflare Workers AI',
        result
      });

    } catch (error) {
      console.error(error);

      return res
        .status(500)
        .json({
          error:
            'Something went wrong while generating product details.'
        });
    }
  }
);

app.listen(
  PORT,
  function() {
    console.log(
      `Cloudflare AI Generator running on port ${PORT}`
    );

    console.log(
      `Using model: ${MODEL}`
    );
  }
);
