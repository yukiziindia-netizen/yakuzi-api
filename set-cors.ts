import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";
dotenv.config();

const client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
});

async function run() {
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: process.env.AWS_BUCKET!,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["PUT", "POST", "GET", "HEAD"],
              AllowedOrigins: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      })
    );
    console.log("CORS updated successfully!");
  } catch (err) {
    console.error("Error setting CORS:", err);
  }
}

run();
