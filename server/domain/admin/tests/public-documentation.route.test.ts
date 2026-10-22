import {beforeEach,describe,expect,it,vi} from "vitest";
import express from "express";
import request from "supertest";
import {publicDocumentationRouter} from "../public-documentation.route";
import {documentationService} from "../documentation.service";
vi.mock("../documentation.service",()=>({documentationService:{getPublicFeatureSpec:vi.fn()}}));
vi.mock("../../../middleware/rate-limiter",()=>({createRateLimiter:()=> (_req:unknown,_res:unknown,next:()=>void)=>next()}));
const app=express();app.use("/api/public/documentation",publicDocumentationRouter);app.use((_err:unknown,_req:unknown,res:express.Response,_next:unknown)=>{res.status(400).json({error:"Rejected"});});
describe("public documentation HTTP bridge",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("serves without authentication and supports conditional revalidation",async()=>{
    vi.mocked(documentationService.getPublicFeatureSpec).mockResolvedValue({slug:"pipelines",title:"Pipelines",markdown:"# Pipelines",sourceUpdatedAt:"2026-10-22T00:00:00Z",revision:"abc123",source:"platform-generator"});
    const response=await request(app).get("/api/public/documentation/pipelines");
    expect(response.status).toBe(200);expect(response.headers.etag).toBe('"abc123"');
    expect(documentationService.getPublicFeatureSpec).toHaveBeenCalledWith("pipelines");
    expect((await request(app).get("/api/public/documentation/pipelines").set("If-None-Match",'"abc123"')).status).toBe(304);
  });
  it("rejects organization/document selectors before reaching the service",async()=>{
    expect((await request(app).get("/api/public/documentation/pipelines?orgId=2&documentId=9")).status).toBe(400);
    expect(documentationService.getPublicFeatureSpec).not.toHaveBeenCalled();
  });
  it("lists only public topic labels, without source files or org metadata",async()=>{
    const response=await request(app).get("/api/public/documentation");expect(response.status).toBe(200);
    expect(response.body.guides).toHaveLength(17);expect(response.body.guides).toEqual(expect.arrayContaining([{slug:"android",title:"Android app"},{slug:"desktop",title:"Electron desktop app"}]));expect(Object.keys(response.body.guides[0]).sort()).toEqual(["slug","title"]);
  });
});
