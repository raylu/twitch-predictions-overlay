import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import z from "zod";

import { api } from "~/utils/api";
import { stringToJsonSchema } from "~/utils/stringToJson";

const twitchWebsocketMessageMetadataSchema = z.object({
  message_id: z.string(),
  message_type: z.string(),
  message_timestamp: z.string(),
  subscription_type: z.optional(z.string()),
  subscription_version: z.optional(z.string()),
});

const twitchWebsocketMessageSessionSchema = z.object({
  id: z.string(),
  status: z.string(),
  connected_at: z.string(),
  keepalive_timeout_seconds: z.number(),
  reconnect_url: z.nullable(z.string()),
});

const twitchWebsocketMessageTopPredictorsSchema = z.object({
  user_id: z.string(),
  user_login: z.string(),
  user_name: z.string(),
  channel_points_won: z.nullable(z.number()),
  channel_points_used: z.number(),
});

const twitchWebsocketMessageOutcomeSchema = z.object({
  id: z.string(),
  title: z.string(),
  color: z.string(),
  users: z.optional(z.number()),
  channel_points: z.optional(z.number()),
  top_predictors: z.optional(twitchWebsocketMessageTopPredictorsSchema.array()),
});

type TwitchTopPredictor = z.infer<
  typeof twitchWebsocketMessageTopPredictorsSchema
>;
type TwitchOutcome = z.infer<typeof twitchWebsocketMessageOutcomeSchema>;

const twitchWebsocketMessageSubscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  type: z.string(),
  version: z.string(),
  condition: z.object({
    broadcaster_user_id: z.string(),
  }),
  transport: z.object({
    method: z.string(),
    session_id: z.string(),
  }),
  created_at: z.string(),
});

const twitchWebsocketMessageEventSchema = z.object({
  id: z.string(),
  broadcaster_user_id: z.string(),
  broadcaster_user_login: z.string(),
  broadcaster_user_name: z.string(),
  title: z.string(),
  winning_outcome_id: z.optional(z.string()),
  outcomes: twitchWebsocketMessageOutcomeSchema.array(),
  started_at: z.string(),
  locks_at: z.optional(z.string()),
  locked_at: z.optional(z.string()),
  ended_at: z.optional(z.string()),
});

const twitchWebsocketMessagePayloadSchema = z.object({
  session: z.optional(twitchWebsocketMessageSessionSchema),
  subscription: z.optional(twitchWebsocketMessageSubscriptionSchema),
  event: z.optional(twitchWebsocketMessageEventSchema),
});

const twitchWebsocketMessageSchema = z.object({
  metadata: twitchWebsocketMessageMetadataSchema,
  payload: twitchWebsocketMessagePayloadSchema,
});

type TwitchWebsocketMessage = z.infer<typeof twitchWebsocketMessageSchema>;

enum Layout {
  HORIZONTAL,
  VERTICAL,
}

type PredictionProps = {
  title: string;
  outcomes: TwitchOutcome[];
  winner?: string;
  status: PredictionState;
  layout: Layout;
};

function Prediction({
  title,
  outcomes,
  winner,
  status,
  layout,
}: PredictionProps) {
  const colors: string[] = [
    "bg-blue-600",
    "bg-red-600",
    "bg-green-600",
    "bg-purple-600",
    "bg-orange-600",
    "bg-teal-600",
    "bg-yellow-600",
  ];
  let classes =
    "flex-col gap-2 text-center font-sans text-2xl font-bold text-zinc-50 transition-opacity duration-300";
  if (status === PredictionState.STARTED || status == PredictionState.ENDED) {
    classes += " opacity-100";
  } else {
    classes += " opacity-0";
  }
  const listTopPredictors = (winner: string, outcomes: TwitchOutcome[]) => {
    const outcome = outcomes.find((outcome) => {
      return outcome.id === winner;
    });
    return outcome?.top_predictors?.map((predictor) => {
      return (
        <div
          key={predictor.user_id}
          className="bg-zinc-900 p-2 font-bold text-green-500 opacity-35"
        >
          {predictor.user_name} +{predictor.channel_points_won ?? 0} pts
        </div>
      );
    });
  };

  if (layout === Layout.HORIZONTAL) {
    return (
      <div className={classes}>
        <div className="m-2 rounded-full bg-zinc-800 bg-opacity-35 p-2">
          {title}
        </div>
        <div className="flex flex-wrap justify-stretch gap-3 p-2">
          {outcomes.map((outcome, index) => {
            let classes =
              "w-48 flex-grow flex-col rounded-full p-4 text-center text-zinc-50 ";
            classes += colors[index % colors.length];

            return (
              <div key={outcome.id} className={classes}>
                <div className="font-sans text-xl">{outcome.title}</div>
                <div className="font-sans text-lg">
                  {outcome.channel_points ?? 0} pts
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  } else {
    // Layout.VERTICAL
    outcomes.sort((a, b) => {
      if ((a.channel_points ?? 0) < (b.channel_points ?? 0)) {
        return -1;
      } else if ((a.channel_points ?? 0) > (b.channel_points ?? 0)) {
        return 1;
      }
      return 0;
    });
    return (
      <div className={classes}>
        <div className="m-2 rounded-full bg-zinc-800 bg-opacity-35 p-2">
          {title}
        </div>
        <div className="flex gap-3 p-2">
          <div className="flex w-1/2 flex-grow flex-col">
            {winner && listTopPredictors(winner, outcomes)}
          </div>
          <div className="flex w-1/2 flex-grow flex-col justify-stretch gap-3">
            {outcomes.map((outcome, index) => {
              let classes =
                "flex flex-grow rounded-full p-4 text-center text-zinc-50 transition-transform ";
              classes += colors[index % colors.length];

              return (
                <div key={outcome.id} className={classes}>
                  <div className="w-1/2 font-sans text-xl">
                    {outcome.channel_points ?? 0} pts
                  </div>
                  <div className="font-sans text-lg">{outcome.title}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
}

enum PredictionState {
  NOT_STARTED,
  STARTED,
  LOCKED,
  ENDED,
}

export default function Page() {
  const [predictionState, setPredictionState] = useState(
    PredictionState.NOT_STARTED,
  );
  const [socketUrl, setSocketUrl] = useState("wss://eventsub.wss.twitch.tv/ws");
  const [predictionEvent, setPredictionEvent] =
    useState<TwitchWebsocketMessage | null>(null);
  const router = useRouter();
  const subscribeToPredictions = api.subscriptions.predictions.useMutation();
  const { lastMessage } = useWebSocket(socketUrl);

  const handleSubscribingToPredictions = async (
    userId: string,
    sessionId: string,
  ) => {
    await subscribeToPredictions.mutateAsync({
      userId,
      sessionId,
    });
  };

  const handleReconnectUrl = async (reconnect_url: string | null) => {
    setSocketUrl(reconnect_url ?? socketUrl);
  };

  const handleWebsocketMessage = async (
    message: MessageEvent<string> | null,
  ) => {
    if (message) {
      const parsed = twitchWebsocketMessageSchema.parse(
        JSON.parse(message.data),
      );
      if (parsed.metadata.message_type === "session_welcome") {
        if (parsed.payload.session) {
          await handleSubscribingToPredictions(
            router.query.userId as string,
            parsed.payload.session?.id,
          );
        }
      } else if (parsed.metadata.message_type === "session_reconnect") {
        if (parsed.payload.session) {
          await handleReconnectUrl(parsed.payload.session?.reconnect_url);
        }
      } else if (parsed.metadata.message_type === "notification") {
        if (parsed.metadata.subscription_type === "channel.prediction.begin") {
          setPredictionState(PredictionState.STARTED);
          setPredictionEvent(parsed);
        } else if (
          parsed.metadata.subscription_type === "channel.prediction.progress"
        ) {
          setPredictionEvent(parsed);
        } else if (
          parsed.metadata.subscription_type === "channel.prediction.lock"
        ) {
          setPredictionState(PredictionState.LOCKED);
          setPredictionEvent(parsed);
        } else if (
          parsed.metadata.subscription_type === "channel.prediction.end"
        ) {
          setPredictionState(PredictionState.ENDED);
          setPredictionEvent(parsed);
          setTimeout(() => {
            setPredictionState(PredictionState.NOT_STARTED);
          }, 30000);
        }
      }
    }
  };

  useEffect(() => {
    void handleWebsocketMessage(lastMessage);
  }, [lastMessage]);

  return (
    <Prediction
      title={predictionEvent?.payload.event?.title ?? ""}
      outcomes={predictionEvent?.payload.event?.outcomes ?? []}
      winner={predictionEvent?.payload.event?.winning_outcome_id}
      status={predictionState}
      layout={Layout.VERTICAL}
    />
  );
}
