import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("the explicit CI preload intercepts the actual Resend SDK without a provider request", () => {
  const preload = new URL(
    "../../../../deployment/local/tests/mail-preload.mjs",
    import.meta.url,
  ).href;
  const senderModule = new URL("./email.ts", import.meta.url).href;
  const environmentModule = new URL("../config/environment.ts", import.meta.url)
    .href;
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
 let nativeCalls=0;globalThis.fetch=async()=>{nativeCalls++;throw new Error('uncontrolled fixture transport')};
 await import(${JSON.stringify(preload)});
 const {createEmailSender}=await import(${JSON.stringify(senderModule)});
 const {loadEnvironment}=await import(${JSON.stringify(environmentModule)});
 const sender=createEmailSender(loadEnvironment({NODE_ENV:'development',AUTH_TOKEN_SECRET:'synthetic-secret-with-at-least-32-characters',EMAIL_PROVIDER:'resend',EMAIL_FROM:'mail@example.test',RESEND_API_KEY:'synthetic'}));
 await sender.send({to:'recipient@example.test',subject:'Synthetic',text:'private fixture content'});
 if(nativeCalls!==0)throw new Error('provider request escaped fixture');
 console.log('verified');
 `,
    ],
    { encoding: "utf8" },
  );
  expect(output.trim()).toBe("verified");
});
