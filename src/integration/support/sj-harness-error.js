// Disposable harness diagnostics only. No arbitrary messages, stacks, payloads,
// identities, URLs, database metadata or secret-shaped strings are exported.
const names=new Set(['Error','AssertionError','TypeError','RangeError','AbortError','TimeoutError','AppError',
  'RequestValidationError','ConflictError','IntegrationUnavailableError','SessionExpiredError','AuthenticationError',
  'AuthorizationError','DatabaseUnavailableError','SchemaNotReadyError','RateLimitError','CsrfError',
  'PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientValidationError']);
const codes=new Set(['ERR_ASSERTION','VALIDATION_FAILED','SESSION_EXPIRED','AUTHENTICATION_FAILED','FORBIDDEN',
  'DATABASE_UNAVAILABLE','SCHEMA_NOT_READY','RATE_LIMITED','CSRF_REJECTED','VERSION_CONFLICT','SNAPSHOT_STALE',
  'STALE_SNAPSHOT','TARGET_MISMATCH','COMMAND_NOT_FOUND','SOURCE_UNAVAILABLE','AUDIT_UNAVAILABLE',
  'REAL_BANK_HTTP_STATUS_MISMATCH','REASON_REQUIRED','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE',
  'ABORT_ERR','MALWARE_DETECTED','SJ_SUBMISSION_PROFILE_NOT_CURRENT','UI_CHILD_CLOSE_UNCONFIRMED','P2002','P2025','23505','23503','42501']);
const reasons=new Set(['INVALID_DECISION','UNAUTHENTICATED','FORBIDDEN','TARGET_MISMATCH','INVALID_KIND',
  'INVALID_SNAPSHOT','NOT_IN_REVIEW','STALE_SNAPSHOT','SELF_REVIEW','CENTRAL_REVIEW_DISABLED',
  'SOURCE_UNAVAILABLE','AUDIT_UNAVAILABLE','REASON_TOO_LONG','REASON_REQUIRED']);
const values=new Set(['PENDING','SENDING','APPLIED','UNKNOWN','REJECTED','FAILED','QUARANTINED','IN_REVIEW',
  'APPROVED','REVISION_REQUIRED','SUPERSEDED','ARCHIVED','ACKNOWLEDGED','READY','REVOKED','HIDDEN',
  'PUBLISHED','AVAILABLE','NOT_FOUND','COMMAND_PENDING']);
const operators=new Set(['strictEqual','notStrictEqual','deepStrictEqual','notDeepStrictEqual','equal',
  'notEqual','deepEqual','notDeepEqual','==','===','!=','!==','ok','match','doesNotMatch','throws','rejects']);
// Read data descriptors, not getters. A hostile proxy or accessors fail closed.
function field(value,key){
  try{for(let depth=0;value&&typeof value==='object'&&depth<4;depth++,value=Object.getPrototypeOf(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(descriptor)return Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
  }}catch{}
  return undefined;
}
const allowed=(value,set)=>typeof value==='string'&&set.has(value)?value:null;
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1000000?value:null;
function assertionValue(value){
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number')return numeric(value)??{type:'number'};
  const known=allowed(value,values);if(known)return known;
  try{if(Array.isArray(value))return {type:'array',length:numeric(field(value,'length'))};}catch{return {type:'object'};}
  return {type:typeof value==='string'?'string':typeof value==='undefined'?'undefined':'object'};
}
function sanitized(error){
  const result={name:allowed(field(error,'name'),names)||'Error',code:allowed(field(error,'code'),codes)};
  const reason=allowed(field(error,'reason'),reasons);if(reason)result.reason=reason;
  const status=numeric(field(error,'status'));if(Number.isInteger(status)&&status>=100&&status<=599)result.status=status;
  if(field(error,'harnessDiagnosticWriteFailed')===true)result.harnessDiagnosticWriteFailed=true;
  const summary=field(error,'assertion');
  const operator=allowed(field(error,'operator')??field(summary,'operator'),operators);
  if(result.code==='ERR_ASSERTION'&&operator){
    // IPC summaries are sanitized again; they are not trusted merely because
    // another test process sent them. Unknown nested summaries lose detail.
    const actual=field(error,'actual'),expected=field(error,'expected');
    result.assertion={operator,
      actual:assertionValue(actual===undefined?field(summary,'actual'):actual),
      expected:assertionValue(expected===undefined?field(summary,'expected'):expected)};
  }
  return result;
}
function safeHarnessError(error){
  const failure=field(error,'harnessFailure');
  const result=sanitized(failure&&typeof failure==='object'?failure:error);
  if(field(error,'harnessDiagnosticWriteFailed')===true)result.harnessDiagnosticWriteFailed=true;
  return result;
}
module.exports={safeHarnessError};
