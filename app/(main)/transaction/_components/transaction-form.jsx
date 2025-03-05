"use client";

import { createTransaction, udpateTransaction } from "@/actions/transactions";
import { transactionSchema } from "@/app/lib/schema";
import useFetch from "@/hooks/use-fetch";
import { zodResolver } from "@hookform/resolvers/zod";
import { Description } from "@radix-ui/react-dialog";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import ReceiptScanner from "./receipt-scanner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CreateAccountDrawer } from "@/components/create-account-drawer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

const AddTransactionForm = ({ accounts, categories, editMode = false, initialData = null }) => {

  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const {
    register,
    setValue,
    handleSubmit,
    formState: { errors },
    watch,
    getValues,
    reset,
  } = useForm({
    resolver: zodResolver(transactionSchema),
    defaultValues: 
    editMode && initialData ? {
      type:initialData.type,
      amount: initialData.amount,
      description: initialData.description,
      accountId: initialData.accountId,
      category: initialData.category,
      date: new Date(initialData.date),
      isRecurring: initialData.isRecurring,
      ...(initialData.recurringInterval && {
        recurringInterval: initialData.recurringInterval
      })
    } : {
      type: "EXPENSE",
      amount: "",
      description: "",
      accountId: accounts.find((ac) => ac.isDefault)?.id,
      date: new Date(),
      isRecurring: false,
    },
  });
  
  const router = useRouter();
  const {
    loading: transactionLoading,
    fn: transactionFn,
    data: transactionResult,
  } = useFetch(editMode ? udpateTransaction : createTransaction);
  const type = watch("type");
  const isRecurring = watch("isRecurring");
  const date = watch("date");
  const filteredCategories = categories.filter(
    (category) => category.type === type
  );
  const onSubmit = async(data) => {
    const formData = {
        ...data,
        amount: parseFloat(data.amount),
    };
    if(editMode) {
      transactionFn(editId,formData);
    }
    else{
    transactionFn(formData);
    }
  }
  const handleScanComplete = (scannedData) => {
    if(scannedData) {
      setValue("amount",scannedData.amount.toString());
      setValue("date",new Date(scannedData.date));
      if (scannedData.description) {
        setValue("description", scannedData.description)
      }
      if (scannedData.category) {
        setValue("category", scannedData.category)
      }
    }
  }
  useEffect(()=>{
    if (transactionResult?.success && !transactionLoading) {
        toast.success(editMode ? "Transaction Updated Successfully" : "Transaction Created Successfully")
        reset();
        router.push(`/account/${transactionResult.data.accountId}`)
    }
  },[transactionResult, transactionLoading, editMode])
  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
      {!editMode && <ReceiptScanner onScanComplete={handleScanComplete}/>}
      <div className="space-y-2">
        <label className="text-sm font-medium">Type</label>
        <Select
          onValueChange={(value) => setValue("type", value)}
          defaultValue={type}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="INCOME">Income</SelectItem>
          </SelectContent>
        </Select>
        {errors.type && (
          <p className="text-sm text-red-500">{errors.type.messages}</p>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Amount</label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            {...register("amount")}
          />
          {errors.amount && (
            <p className="text-sm text-red-500">{errors.amount.messages}</p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Account</label>
          <Select
            onValueChange={(value) => setValue("accountId", value)}
            defaultValue={getValues("account")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Type" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name} (₹{parseFloat(account.balance).toFixed(2)})
                </SelectItem>
              ))}
              <CreateAccountDrawer>
                <Button
                  variant="ghost"
                  className="w-full select-none items-center text-sm outline-none"
                >
                  Create Account
                </Button>
              </CreateAccountDrawer>
            </SelectContent>
          </Select>
          {errors.accountId && (
            <p className="text-sm text-red-500">{errors.accountId.messages}</p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Category</label>
        <Select
          onValueChange={(value) => setValue("category", value)}
          defaultValue={getValues("category")}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select Type" />
          </SelectTrigger>
          <SelectContent>
            {filteredCategories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.category && (
          <p className="text-sm text-red-500">{errors.category.messages}</p>
        )}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Category</label>
        <Popover>
  <PopoverTrigger asChild>
    <Button variant = 'outline' className='w-full pl-3 text-left font-normal'> {date ? format(date,"PPP"): <span>Pick a Date</span>}
    <CalendarIcon className="w-4 h-4 ml-auto opacity-50"/></Button>
  </PopoverTrigger>
  <PopoverContent className = 'w-auto p-0' align='start' >
    <Calendar mode = 'single' selected = {date} onSelect = {(date)=>setValue("date",date)} disabled={(date)=>date>new Date() || date < new Date("1900-01-01")} initialFocus>
        </Calendar></PopoverContent>
</Popover>

        {errors.date && (
          <p className="text-sm text-red-500">{errors.date.messages}</p>
        )}
      </div>
      <div className="space-y-2">
          <label className="text-sm font-medium">Description</label>
          <Input
            placeholder="Enter Description"
            {...register("description")}
          />
          {errors.description && (
            <p className="text-sm text-red-500">{errors.description.messages}</p>
          )}
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <label
                          htmlFor="isDefault"
                          className="text-base font-medium cursor-pointer"
                        >
                          Recurring Transaction
                        </label>
                        <p className="text-sm text-muted-foreground">
                         Set up a Recurring Schedule for this Transaction
                        </p>
                      </div>
                      <Switch
                        checked={isRecurring}
                        onCheckedChange={(checked) => setValue("isRecurring", checked)}
                      />
                    </div>
                    {isRecurring &&  (
                        <div className="space-y-2">
                        <label className="text-sm font-medium">Recurring Interval</label>
                        <Select
                          onValueChange={(value) => setValue("recurringInterval", value)}
                          defaultValue={getValues("recurringInterval")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select Interval" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value = "DAILY">Daily</SelectItem>
                            <SelectItem value = "WEEKLY">Weekly</SelectItem>
                            <SelectItem value = "MONTHLY">Monthly</SelectItem>
                            <SelectItem value = "YEARLY">Yearly</SelectItem>
                          </SelectContent>
                        </Select>
                        {errors.recurringInterval && (
                          <p className="text-sm text-red-500">{errors.recurringInterval.messages}</p>
                        )}
                      </div>
                    )}
                    <div className="flex gap-4">
                        <Button variant = 'outline' type = 'button' className = 'w-full' onClick = {()=>router.back()}>Cancel</Button>
                        <Button type = 'submit' className = 'w-full' disabled = {transactionLoading}>
                        {transactionLoading ? (
                          <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                          {editMode ? "Updating..." : "Creating..."} </>
                        ) : editMode ? (
                          "Update Transaction"
                        ) : (
                          "Create Transaction"
                        )}</Button>
                    </div>
    </form>
  );
};

export default AddTransactionForm;
