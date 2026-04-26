export enum ErrorCode {
  CLIENT_ERROR = 1,
  SERVER_ERROR = 2,
  NETWORK_ERROR = 3,
  AUTH_ERROR = 4,
}

export interface CliError {
  code: ErrorCode;
  type: string;
  message: string;
  details?: string;
  suggestion?: string;
}

export function formatCliError(error: CliError): string {
  const lines: string[] = [];

  lines.push(`Error [${error.type}]: ${error.message}`);

  if (error.details) {
    lines.push(`  Details: ${error.details}`);
  }

  if (error.suggestion) {
    lines.push(`  Suggestion: ${error.suggestion}`);
  }

  return lines.join('\n');
}
