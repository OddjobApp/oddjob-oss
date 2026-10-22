import {describe,it,expect} from "vitest";
import {publicDocumentationLink} from "./public-documentation-links";
import {resolveSpaTemplate} from "./spa-routes";
describe("public documentation navigation",()=>{
  it("serves the public reader from the login SPA without capturing other paths",()=>{
    expect(resolveSpaTemplate("/docs/pipelines")).toBe("login.html");
    expect(resolveSpaTemplate("/docs-private")).toBeNull();
  });
  it("bridges approved guides and suppresses repository and unsafe links",()=>{
    expect(publicDocumentationLink("https://github.com/OddjobApp/oddjob-oss/blob/main/server/knowledge/public-features/agentmail.md","integrations")).toBe("/docs/agentmail");
    expect(publicDocumentationLink("https://github.com/OddjobApp/oddjob-oss/blob/main/private.md","pipelines")).toBeUndefined();
    expect(publicDocumentationLink("javascript:alert(1)","pipelines")).toBeUndefined();
    expect(publicDocumentationLink("../private.md","pipelines")).toBeUndefined();
    expect(publicDocumentationLink("#overview","pipelines")).toBe("#overview");
  });
});
