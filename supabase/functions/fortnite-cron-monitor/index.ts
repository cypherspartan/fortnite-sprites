import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", {
            headers: corsHeaders,
        });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const discordWebhook = Deno.env.get("DISCORD_WEBHOOK_URL");

        if (!supabaseUrl || !serviceRoleKey) {
            throw new Error("Supabase environment variables are missing");
        }

        if (!discordWebhook) {
            throw new Error("DISCORD_WEBHOOK_URL secret is missing");
        }

        const supabase = createClient(
            supabaseUrl,
            serviceRoleKey,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            },
        );

        // ------------------------------------------------------------
        // Get the latest Fortnite Cron execution.
        // ------------------------------------------------------------

        const { data: cronData, error: cronError } =
            await supabase.rpc("get_fortnite_cron_status");

        if (cronError) {
            throw new Error(
                `Failed to read Cron status: ${cronError.message}`,
            );
        }

        const latestRun = Array.isArray(cronData)
            ? cronData[0]
            : cronData;

        if (!latestRun) {
            throw new Error(
                "No Fortnite Cron execution was found",
            );
        }

        const status = latestRun.status;
        const runId = latestRun.run_id;
        const started = latestRun.started_eastern;
        const finished = latestRun.finished_eastern;
        const returnMessage = latestRun.return_message;

        // ------------------------------------------------------------
        // Successful run = nothing to alert.
        // ------------------------------------------------------------

        if (status === "succeeded") {
            return Response.json({
                success: true,
                alerted: false,
                reason: "Latest Cron run succeeded",
                status,
                runId,
            });
        }

        // ------------------------------------------------------------
        // Check whether this failure was already alerted.
        // ------------------------------------------------------------

        const {
            data: lastAlertedRun,
            error: lastAlertedError,
        } = await supabase.rpc(
            "get_fortnite_cron_last_alerted_run",
        );

        if (lastAlertedError) {
            throw new Error(
                `Failed to read alert state: ${lastAlertedError.message}`,
            );
        }

        if (lastAlertedRun === runId) {
            return Response.json({
                success: true,
                alerted: false,
                reason: "This failed run was already alerted",
                status,
                runId,
            });
        }

        // ------------------------------------------------------------
        // Send Discord alert.
        // ------------------------------------------------------------

        const discordMessage = {
            content: "🚨 **Fortnite Sprite Collection Update Failed**",
            embeds: [
                {
                    title: "Fortnite Sprite Collection Monitor",
                    description:
                        "The scheduled Sprite Collection update failed.",
                    fields: [
                        {
                            name: "Status",
                            value: String(status),
                            inline: true,
                        },
                        {
                            name: "Run ID",
                            value: String(runId),
                            inline: true,
                        },
                        {
                            name: "Started",
                            value: String(started),
                            inline: false,
                        },
                        {
                            name: "Finished",
                            value: String(finished || "Unknown"),
                            inline: false,
                        },
                        {
                            name: "Cron Response",
                            value: String(
                                returnMessage || "No response",
                            ),
                            inline: false,
                        },
                    ],
                },
            ],
        };

        const discordResponse = await fetch(
            discordWebhook,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(discordMessage),
            },
        );

        if (!discordResponse.ok) {
            const body = await discordResponse.text();

            throw new Error(
                `Discord webhook failed: ${discordResponse.status} ${body}`,
            );
        }

        // ------------------------------------------------------------
        // Record that this failure generated an alert.
        // ------------------------------------------------------------

        const {
            error: recordAlertError,
        } = await supabase.rpc(
            "set_fortnite_cron_last_alerted_run",
            {
                new_run_id: runId,
            },
        );

        if (recordAlertError) {
            throw new Error(
                `Discord alert sent, but failed to record alert state: ${recordAlertError.message}`,
            );
        }

        return Response.json({
            success: true,
            alerted: true,
            status,
            runId,
        });
    } catch (error) {
        console.error(error);

        return Response.json(
            {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            {
                status: 500,
            },
        );
    }
});
