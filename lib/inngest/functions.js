import { inngest } from "./client";
import { db } from "../prisma";
import { sendEmail } from "@/actions/send-email";
import EmailTemplate from "@/emails/template";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const checkBudgetAlert = inngest.createFunction(
  { name: "Check Budget Alert" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    const budgets = await step.run("fetch-budget",async()=>{
        return await db.budget.findMany({
            include:{
                user:{
                    include:{
                        accounts:{
                            where:{
                                isDefault: true,
                            }
                        }
                    }
                }
            }
        })
    })
    for(const budget of budgets) {
        const defaultAccount = budget.user.accounts[0];
        if(!defaultAccount) continue;
        await step.run(`check-budget-${budget.id}`,async()=> {
            const currentDate = new Date();
            const startOfMonth = new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                1
              );
              const endOfMonth = new Date(
                currentDate.getFullYear(),
                currentDate.getMonth() + 1,
                0
              );
            const expenses = await db.transaction.aggregate({
                where:{
                    userId:budget.userId,
                    accountId:defaultAccount.id,
                    type: "EXPENSE",
                    date:{
                        gte: startOfMonth,
                        lte: endOfMonth,
                    },
                },
                _sum: {
                    amount:true
                }
            })
            const totalExpenses = expenses._sum.amount?.toNumber() || 0;
            const budgetAmount = budget.amount;
            const percentageUsed = (totalExpenses / budgetAmount) * 100;
            console.log(percentageUsed)
            if(percentageUsed >= 80 && (!budget.lastAlertSent || isNewMonth(new Date(budget.lastAlertSent), new Date()))){
                console.log(percentageUsed, budget.lastAlertSent)
                await sendEmail({
                    to:budget.user.email,
                    subject: `Budget Alert for ${defaultAccount.name}`,
                    react:EmailTemplate({
                        userName:budget.user.name,
                        type:'budget-alert',
                        data:{
                            percentageUsed,
                            budgetAmount:parseInt(budgetAmount).toFixed(1),
                            totalExpenses:parseInt(totalExpenses).toFixed(1),
                            accountName:defaultAccount.name,
                        }
                    })
                })
                await db.budget.update({
                    where: {
                        id: budget.id,
                    },
                    data: {
                        lastAlertSent: new Date()
                    },
                })
            }
        });
    }
  },
);

function isNewMonth(lastAlertSent, currentDate) {
    return (
        lastAlertSent.getMonth()!==currentDate.getMonth() || 
        lastAlertSent.getFullYear()!==currentDate.getFullYear()
    );
}

export const triggerRecurringTransaction = inngest.createFunction({
    id: "trigger-recurring-transactions",
    name: "Trigger Recurring Transactions",
},{cron: "0 0 * * *"},
async({step})=>{
    const recurringTransactions = await step.run(
        "fetch-recurring-transactions",
        async () => {
            return await db.transaction.findMany({
                where: {
                    isRecurring: true,
                    status: "COMPLETED",
                    OR: [
                        {
                            lastProcessed: null,
                        },
                        { 
                            nextRecurringDate: { lte: new Date() }
                        },
                    ]
                }
            })
        }
    )
    if(recurringTransactions.length > 0) {
        const events = recurringTransactions.map((transaction) => ({
            name: 'transaction.recurring.process',
            data: { transactionId: transaction.id, userId: transaction.userId },
        }))
        await inngest.send(events)
    }
    return { triggered: recurringTransactions.length }
})

function calculateNextRecurringDate(startDate, interval){
    const date = new Date(startDate);
    switch(interval){
        case "DAILY":
            date.setDate(date.getDate() + 1);
            break;
        case "WEEKLY":
            date.setDate(date.getDate() + 7);
            break;
        case "MONTHLY":
            date.setDate(date.getMonth() + 1);
            break;
        case "YEARLY":
            date.setFullYear(date.getFullYear() + 1);
            break;
    }
    return date;
}

export const processRecurringTransaction = inngest.createFunction({
    id:'process-recurring-transaction',
    throttle: {
        limit: 10,
        period: "1m",
        key: "event.data.userId"
    },
},
{ event: 'transaction.recurring.process' },
 async({event,step})=>{
    if(!event?.data?.transactionId || !event?.data?.userId) {
        console.error("Invalid event data: ",event);
        return {error:"Missing required event data"}
    }
    await step.run("process-transaction",async()=>{
        const transaction = await db.transaction.findUnique({
            where: {
                id: event.data.transactionId,
                userId: event.data.userId,
            },
            include: {
                account: true,
            }
        })
        if (!transaction || !isTransactionDue(transaction)) return;
        await db.$transaction(async(tx)=>{
            await tx.transaction.create({
                data: {
                    type: transaction.type,
                    amount: transaction.amount,
                    description: `${transaction.description} (Recurring)`,
                    date: new Date(),
                    category: transaction.category,
                    userId: transaction.userId,
                    accountId: transaction.accountId,
                    isRecurring: false,
                }
            })
            const balanceChange = transaction.type === "EXPENSE" ? -transaction.amount.toNumber() : transaction.amount.toNumber()
            await tx.account.update ({
                where: { id: transaction.accountId },
                data: { balance: { increment: balanceChange } },
            })
            await tx.transaction.update({
                where: { id: transaction.id },
                data: {
                    lastProcessed: new Date(),
                    nextRecurringDate: calculateNextRecurringDate(
                        new Date(),
                        transaction.recurringInterval
                    )
                }
            })
        })
    })
 }
)

function isTransactionDue (transaction) {
    if(!transaction.lastProcessed) return true;
    const today = new Date();
    const nextDue = new Date(transaction.nextRecurringDate);
    return nextDue <= today;
}

export const generateMonthlyReports = inngest.createFunction({
    id:'generate-monthly-reports',
    name:'Generate Monthly Reports'
},{
    cron: "0 0 1 * *"
},async({step})=>{
    const users = await step.run("fetch-users", async()=> {
        return await db.user.findMany({
            include:{accounts:true},
        })
    })
    for (const user of users) {
        await step.run(`generate-report-${user.id}`,async () => {
            const lastMonth = new Date();
            lastMonth.setMonth(lastMonth.getMonth() - 1);
            
            console.log(`Generating report for user ${user.id}:`, {
                userName: user.name,
                email: user.email,
                lastMonth: lastMonth.toISOString()
            });

            const stats = await getMonthlyStats(user.id, lastMonth);
            
            console.log(`Monthly Stats for user ${user.id}:`, JSON.stringify(stats, null, 2));

            const monthName = lastMonth.toLocaleString("default",{
                month:"long",
            })
            
            // Fallback insights if stats are empty
            let insights = [
                "No significant financial activity this month.",
                "Consider tracking your expenses more closely.",
                "Review your spending habits in the coming month."
            ];

            // Only generate AI insights if there are actual transactions
            if (stats.transactionCount > 0) {
                try {
                    insights = await generateFinancialInsights(stats, monthName);
                } catch (error) {
                    console.error(`Error generating insights for user ${user.id}:`, error);
                }
            }

            await sendEmail({
                to:user.email,
                subject: `Your Monthly Financial Report - ${monthName}`,
                react: EmailTemplate({
                    userName:user.name,
                    type:'monthly-report',
                    data:{
                        stats,
                        month: monthName,
                        insights
                    }
                })
            })
        })
    }
    return { processed: users.length }
});

async function generateFinancialInsights(stats, month){
    // Log the stats before generating insights
    console.log('Generating Insights with Stats:', JSON.stringify(stats, null, 2));

    // If no expenses, return default insights
    if (stats.totalExpenses === 0) {
        return [
            "No expenses recorded this month.",
            "Great opportunity to start tracking your spending.",
            "Consider setting up a budget for next month."
        ];
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({model:'gemini-2.0-flash'});
    const prompt = `
    Analyze this financial data and provide 3 concise, actionable insights.
    Focus on spending patterns and **practical advice on how to save more**.
    Keep it friendly and conversational.

    Financial Data for ${month}:
    - Total Income: ₹${stats.totalIncome.toFixed(2)}
    - Total Expenses: ₹${stats.totalExpenses.toFixed(2)}
    - Net Income: ₹${(stats.totalIncome - stats.totalExpenses).toFixed(2)}
    - Expense Categories: ${Object.entries(stats.byCategory)
      .map(([category, amount]) => `${category}: ₹${amount.toFixed(2)}`)
      .join(", ")}

    Format the response as a JSON array of strings, like this:
    [
      "Insight 1: [Spending pattern observation] – [How to cut back] – [Where to reallocate money]",
      "Insight 2: ...",
      "Insight 3: ..."
    ]
  `;
  try{
    const result = await model.generateContent(prompt)
    const response = await result.response;
    const text = response.text();
    const cleanedText = text.replace(/```(?:json)?\n?/g,"").trim();
    
    // Log the raw response
    console.log('Raw AI Response:', text);
    
    const parsedInsights = JSON.parse(cleanedText);
    
    // Log the parsed insights
    console.log('Parsed Insights:', parsedInsights);
    
    return parsedInsights;
  }
  catch (error){
    console.error("Error generating insights:", error);
    return [
        "Your highest expense category this month might need attention.",
        "Consider setting up a budget for better financial management.",
        "Track your recurring expenses to identify potential savings.",
    ];
  }
}

const getMonthlyStats = async(userId, month) => {
    // Create a new Date object for the start of the month in the user's local time
    const startDate = new Date(month.getFullYear(), month.getMonth(), 1, 0, 0, 0, 0);
    
    // Create a new Date object for the end of the month in the user's local time
    const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);

    // Convert to UTC to ensure consistent database querying
    const startDateUTC = new Date(Date.UTC(
        startDate.getFullYear(), 
        startDate.getMonth(), 
        startDate.getDate(), 
        0, 0, 0, 0
    ));

    const endDateUTC = new Date(Date.UTC(
        endDate.getFullYear(), 
        endDate.getMonth(), 
        endDate.getDate(), 
        23, 59, 59, 999
    ));
    
    console.log('Comprehensive Date Debugging:', {
        originalMonth: month,
        startDateLocal: startDate,
        endDateLocal: endDate,
        startDateUTC: startDateUTC,
        endDateUTC: endDateUTC,
        userId
    });

    // Fetch all transactions for the user to understand the full context
    const allUserTransactions = await db.transaction.findMany({
        where: {
            userId: userId
        },
        orderBy: {
            date: 'asc'
        }
    });

    console.log('All User Transactions Full Details:', allUserTransactions.map(t => ({
        id: t.id,
        date: t.date,
        dateISO: t.date.toISOString(),
        type: t.type,
        amount: t.amount.toNumber(),
        category: t.category
    })));

    // Query transactions with UTC dates
    const transactions = await db.transaction.findMany({
        where: {
            userId,
            date: {
                gte: startDateUTC,
                lte: endDateUTC,
            }
        }
    });

    console.log('Monthly Transactions Detailed Debug:', {
        transactionCount: transactions.length,
        transactionDetails: transactions.map(t => ({
            id: t.id,
            date: t.date,
            dateISO: t.date.toISOString(),
            type: t.type,
            amount: t.amount.toNumber(),
            category: t.category
        }))
    });

    // If no transactions found, log additional context
    if (transactions.length === 0) {
        console.warn('No transactions found for the specified month', {
            userId,
            startDateUTC: startDateUTC.toISOString(),
            endDateUTC: endDateUTC.toISOString(),
            totalUserTransactions: allUserTransactions.length
        });
    }

    return transactions.reduce((stats, t) => {
        const amount = t.amount.toNumber();

        if(t.type === 'EXPENSE') {
            stats.totalExpenses += amount;
            stats.byCategory[t.category] = (stats.byCategory[t.category] || 0) + amount;
        }
        else if(t.type === 'INCOME') {
            stats.totalIncome += amount;
        }
        else {
            console.warn('Unknown transaction type:', t.type);
        }
        return stats;
    }, {
        totalExpenses: 0,
        totalIncome: 0,
        byCategory: {},
        transactionCount: transactions.length,
    });
}