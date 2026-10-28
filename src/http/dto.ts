import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInvoiceDto {
  @ApiProperty({ type: String, example: 'SEM-2026-001' })
  @IsString() @MinLength(1) @MaxLength(100)
  erpReference!: string;
  @ApiProperty({ type: String, example: 'STUDENT-001' })
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,50}$/)
  studentReference!: string;
  @ApiProperty({ type: String, example: '9999999999' })
  @IsString() @Matches(/^[6-9]\d{9}$/)
  customerPhone!: string;
  @ApiProperty({ type: Number, example: 10000, description: 'Integer paise; 10000 = INR 100.00' })
  @IsInt() @Min(100) @Max(1000000000)
  amountMinor!: number;
}
export class CreateOrderDto {
  @ApiProperty({ type: String, example: '11111111-1111-4111-8111-111111111111' })
  @IsUUID()
  invoiceId!: string;
  @ApiProperty({ type: Boolean, required: false, description: 'Force creation of a new payment session' })
  @IsOptional()
  @IsBoolean()
  forceNew?: boolean;
}
