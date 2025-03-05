"use client";
import { ScanReceipt } from '@/actions/transactions';
import useFetch from '@/hooks/use-fetch';
import { Camera, Loader2 } from 'lucide-react';
import React, { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const ReceiptScanner = ({onScanComplete}) => {
    const fileInputRef = useRef();
    const {
        loading:scanReceiptLoading,
        fn:scanReceiptFn,
        data:scannedData,
    } = useFetch(ScanReceipt)

    const handleReceiptScan = async(file) => {
        if(file.size>5*1024*1024) {
            toast.error("File size should be less than 5MB")
        }
        await scanReceiptFn(file);
    }

    useEffect(()=>{
        if (scannedData && !scanReceiptLoading) {
            onScanComplete(scannedData);
            toast.success("Receipt successfully scanned!")
        }
    }, [scanReceiptLoading, scannedData])

  return (
    <div>
      <input type = 'file' ref = {fileInputRef} className='hidden' accept='image/*' capture = 'environment' onChange = {(e)=>{
        const file = e.target.files?.[0];
        if (file) handleReceiptScan(file);
      }}/>
      <Button onClick={()=>fileInputRef.current?.click()} className='w-full h-10 bg-gradient-to-br from-orange-500 via-pink-500 to-purple-500 animate-gradient hover:opacity-90 transition-opacity text-white hover:text-white'>{scanReceiptLoading ? (<>
      <Loader2 className='mr-2 animate-spin'/><span>Scanning Receipt...</span></>) : (<>
      {" "}
      <Camera className='mr-2'/>
      <span>Scan Receipt with AI</span></>)}</Button>
    </div>
  )
}

export default ReceiptScanner
